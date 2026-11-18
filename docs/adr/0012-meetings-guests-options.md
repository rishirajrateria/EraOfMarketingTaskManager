# ADR 0012 — Meetings like Google Calendar: guests, start time, Calendar options, find a time; team capacity header

- Status: Accepted
- Date: 2026-10-10
- Extends: SPEC §6 (add-task flow), §8 (Google automation), §9.2 (availability); ADR 0003 (Google integration),
  ADR 0008 (team-first assignment — unchanged for work tasks), ADR 0010 (add-task body)
- Reference: the owner's prototype `docs/prototype/eom-tasks.html` (`meetingGuests`, `guestsSheet`, `optionsSheet`,
  `findTimeSheet`, the `tRowStart` row)

## Context

Meetings were created from the add-task sheet (Meet icon) and already became a Calendar event with a Meet link, but the
sheet was the task sheet: a voice-note mic, "How long" in task presets, no start-time row, attendees only from the app's
people, and no Calendar options. The owner wants creating a meeting here to match creating one in Google Calendar.
Separately, the cyan inventory header took a lot of space before a team was even chosen and its numbers were unlabelled.

## Decisions

### Data (migration `20261010180000_meeting_guests_options`)
- `Task.guestEmails String[] @default([])` — external guests (the client's addresses + typed ones), lowercased, deduped.
- `Task.meetingOptions Json?` — validated by `meetingOptionsSchema` (`src/server/tasks/schema.ts`); every field has a
  default so partial payloads parse: `reminders` [{ method popup|email, minutes 0…40320 }] (max 5, default one popup
  10 min), `guestsCanModify` (false), `guestsCanInviteOthers` (true), `guestsCanSeeOtherGuests` (true), `location`,
  `transparency` opaque|transparent, `visibility` default|public|private, `colorId` "" | "1"…"11", `allDay`, `timeZone`
  ("" = company zone; the server stores the resolved zone), `withMeet` (true).
- Internal people stay **assignees** (`TaskAssignee`) so the meeting is on their dashboard; nothing else changes for work
  tasks (their `guestEmails` is always `[]` and `meetingOptions` null).

### Who is invited (`planMeeting` in `src/server/tasks/assignment.ts`)
- Any dashboard role, as before ("anyone with a dashboard may invite anyone to a meeting").
- Assignees = **the organiser** + the active **Team Leader(s) of the invited teams** (`teamLeaderIds`, team ids validated
  as active) + the people picked in the Guests sheet. Executives are never added by a team pick (owner's revision) —
  they are optional, unselected chips under "Your people". For meetings the TEAM row is multi-select for every role and
  no team is required. At least one invitee besides the
  organiser (an internal person or a guest email) is required: "Invite someone: pick a team, people or add a guest email".
- The organiser is always on the meeting, as in Google Calendar (they are also an assignee, so a meeting with only
  outside guests is a self-assigned meeting).
- Calendar attendees for meetings = organiser + assignees + `guestEmails` (deduped, lowercased) — no longer every Admin
  and Team Leader as for work tasks. Drive sharing and Chat membership never include external guests (`internal`
  emails in `taskContext`).

### Google Calendar (`src/google/event-body.ts`, `calendar.ts`, `task-integrations.ts`)
- `toCalendarEventBody(task, options, tz)` is a pure mapper (unit-tested): reminders → `{ useDefault: false, overrides }`
  (capped at 5), permissions → `guestsCan*`, `location`, `transparency`, `visibility`, `colorId` ("" → null = calendar
  colour), all day → `{ date }` start and an **exclusive** next-day end, otherwise `{ dateTime, timeZone }`; the zone is
  the option's, else the company's. Without options (work tasks) the body is what it was.
- **Meet links are created through the Calendar API**: `conferenceData.createRequest` with
  `conferenceSolutionKey.type = "hangoutsMeet"` and `conferenceDataVersion: 1`; `withMeet: false` sends no conference
  (version 0) — a plain calendar event.
- **Invites are sent by Google Calendar** (`sendUpdates: "all"` on insert and patch); the app sends no emails of its own.
- `createEvent` / `updateEvent` take `options` + `timeZone`. Edits (`updateTask` → `CALENDAR_UPDATE`) re-apply the
  attendees, description (agenda) and options; toggling Meet adds (`createRequest`) or removes (`conferenceData: null`)
  the conference and stores the new link.
- The service account needs **domain-wide delegation with the `https://www.googleapis.com/auth/calendar` scope**
  (already in `SA_SCOPES`); events live on the impersonated company user's primary calendar and free/busy is read with
  the same credentials.
- **Nothing is sent in `GOOGLE_MOCK` mode**: the wrappers accept the options and return fake event ids / Meet links.

### Add-task sheet for meetings (`src/components/tasks/*`)
- No ★ Important chip and no voice-note mic (the description editor — with its dictation button — is the agenda; voice notes are filtered out
  client-side and `uploadAttachment` refuses `VOICE_NOTE` on meetings).
- **Duration**: 15m 30m 45m 1h 1½h 2h + the 15-minute stepper; 30m by default. `allocatedMinutes` = duration.
- **START** row directly above the bottom bar: a pill every 30 minutes 9 am … 8 pm (prototype `t12` labels) and
  **Custom…** (native time input). The day comes from Tom / today / the calendar-icon sheet, else today when the time is
  still ahead, else tomorrow (meeting zone). With a time picked, upnext is off and Tom / today only change the day.
- Summary line "📅 <day> <start>–<end> · <duration> · <n> guests" (+ the zone when it isn't the company's);
  card "Inviting … · Guests: …" with "<client> has no email — add one in Clients".
- **⟳ Recurring** works for meetings as for tasks (the same repeat picker); each occurrence is its own Calendar event
  with the same guests and options (`spawnNextOccurrence` copies `guestEmails` / `meetingOptions`).
- **👥 Guests** chip and the people glyph (badge = invitees besides me + outside guests) open the Guests sheet: "From
  client" chips (Client.email + any address in Client.contact), "From teams · <Team>" with just its Team Leader
  ("Karan Mehta · Team leader", ✕ un-invites the team; "<Team> has no Team Leader yet" otherwise), "Your people"
  (everyone else, unselected until tapped; you are "(organiser)"), and "Add guests" (Enter / comma / blur add; a paste of several addresses adds them all; invalid ones are
  reported and stay in the input).
- **⚙ Options** sheet with every option above; All day hides START and Duration.
- **Find a time** (from Guests or Options): server action `meetingBusy` returns each internal guest's busy blocks on a
  day between 08:00 and 21:00 (meeting zone) from Calendar free/busy (`freeBusyMany`, one query) — or, in GOOGLE_MOCK mode
  and for anyone whose calendar can't be read, from the app's own open tasks / meetings. `suggestSlots` (pure) merges the
  blocks and returns the first three non-overlapping slots of the duration on a 15-minute grid, never in the past.
  External guests are not checked (said in the sheet).
- Edit sheet: "Edit meeting" with Outside guests chips and a Meeting options button (same sheet); times in the meeting
  zone. Detail sheet: "Meeting details", **Join Google Meet**, People, Guests, Location, all day / zone / Meet off.

### Capacity header (owner's revision; `AddTaskHeader`, `addTaskInventory`)
- Hidden until a team is known: Admin → the teams picked in the TEAM row; Team Leader / Executive → their own team
  (none → hidden). It collapses / expands with a 300 ms grid-rows transition (none with `prefers-reduced-motion`).
- One slim cyan row of four cells — TODAY / TOM / WEEK / MONTH — each "13h left" and "2h booked" (≥ 10h shown whole).
- `addTaskInventory(teamIds)` (zod: 1–20 ids, active teams; Team Leaders and Executives only their own team) returns
  `{ leftMinutes, bookedMinutes, count }` per period for all active members of those teams (Team Leader + executives):
  booked = the inventory's assigned minutes (open tasks, per person), left = capacity − booked.

## Consequences
- An Admin meeting with a team still invites that team's Team Leader, and now also the Admin (organiser).
- Recurring meetings create one Calendar event per occurrence (not a single event with an RRULE), so guests get one
  invite per occurrence, sent when the occurrence is created.
- The card never prints "null" / "undefined": it only joins known names, and a team without a Team Leader is called out.
- `inventoryScope` and the per-person header scope are gone; the header is per team.
