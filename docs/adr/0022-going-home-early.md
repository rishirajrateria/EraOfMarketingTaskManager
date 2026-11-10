# ADR 0022 — Going home early

- Status: Accepted
- Date: 2026-11-10
- Builds on: ADR 0019 (one source of truth for availability), ADR 0017 (notifications vs requests), SPEC §9.3, §11.5
- Prototype: `docs/prototype/eom-tasks.html` — `earlySheet`, `awayRecs`, `coverKeys`, `hitsRec`, `shiftBanners`,
  `planShift`, `shiftAllSheet`, `rescheduleSheet`, `backPromptCards`, `answerBack` (`#demoMorning` is demo-only: here
  a job does it)

## Context

Someone falls sick at 2pm. Until now the only tools were a full-day attendance row or a leave request: neither
removed the afternoon from the person's capacity, and nothing told Admin which of their tasks now sat in time they
would not work. The owner's rules: only Admin and HR mark it; it covers the rest of today and either a picked number
of days or "ask tomorrow"; the tasks in that time are flagged and Admin shifts them.

## Decision

### Model

`EarlyLeave` (migration `20261110120000_early_leave`): `userId`, `day` (the leaving day, company zone), `leftAt`,
`reason` (SICK · PERSONAL · OTHER), `mode` (UNTIL · ASK), `until`, `coveredThrough`, `askDay` / `askedAt` (the morning
question waiting), `backOn`, `active`, `createdById`, `cancelledById` / `cancelledAt`. All `@db.Date` columns are read
with `fromDbDate` (ADR 0019).

- **Covered period** = `[leftAt, start of the day after coveredThrough)` in the company zone.
- UNTIL: `coveredThrough = until`. ASK: `coveredThrough = day`; every "Still off" extends it to the asked day.
- One active early leave per person: marking again replaces the earlier one. Cancel sets `active = false` and
  everything (availability, flags, questions) goes back to normal.

### Availability: through `personDayStatus`, no parallel path

`loadAvailability` loads active early leaves next to approved leave and attendance rows and passes an `away` mark to
`personDayStatus`:

- **Precedence**: approved leave > company holiday > weekly off > attendance row (ABSENT / LEAVE / HOLIDAY) > early
  leave > HALF / WORKING.
- **Leaving day**: kind stays WORKING (or HALF); the window is clipped to end at `leftAt` and
  `capacityMinutes = min(capacity, working minutes left before leftAt)`.
- **Later covered days**: new kind `AWAY` — no window, 0 capacity.
- `PersonDay.away` carries the mark so screens can label it.

Inventory, the add-task header, the HR tile, the Day view (`AWAY` row status, hours after `leftAt` shown off), the
slot finder and the "<Name> is off that day" warning all read that one function, so they agree by construction
(`tests/attendance/early-leave.test.ts`, like `slot-agreement.test.ts`).

Attendance shows "Left early 2:15pm · Sick" on the day (grid cell "E") and "Away · Sick" on later covered days
(cell "AW", counted as absent; the CSV puts the label in the note column).

### Who

Only Admin and HR mark, cancel and answer the morning question (`requireRole("ADMIN", "HR")`). Only Admin shifts
(`requireRole("ADMIN")`); HR sees the same banner read-only: "Admin will shift these".

Entry points: Attendance → Today (HR and Admin: every Team Leader / Executive with today's status and "Going home
early" / "Cancel early leave") and the person's row in Admin's HR dashboard view.

### Flagging

A task is flagged **Needs shifting** when it is open (ASSIGNED, STARTED, PAUSED, FINISH_REQUESTED — not drafts or
completed), assigned to the person, and its `[scheduledStart, scheduledEnd)` overlaps the covered period (a deadline
when its instant is inside). Tasks before `leftAt` are not flagged. The flag is **computed, never stored**
(`hitsPeriod`): once a task is moved out of the period or reassigned it is no longer flagged.

Admin's dashboard shows an orange ribbon "Needs shifting" and an orange ring on flagged rows (orange is used by no
other row colour) and a banner above the list: "<Name> left early · N tasks need shifting", then
"2:15pm · Sick · away until 11 Nov" / "… · asking again tomorrow morning", with:

- **Shift all to next free slots** — a confirm sheet lists each task, before → after. The plan is a dry run of the
  leave shift's `proposeSlot` (ADR 0019) from `max(now, end of the covered period)`; each planned placement is passed
  back in as busy time and booked minutes (`BusyOptions.extra`), so applying them one by one gives exactly the times
  shown. Applying re-plans and saves through `applyTaskMove` (extracted from `shiftTaskToNextSlot`). Deadline-only
  tasks move to the first day after the period on which no assignee is off.
- **Shift manually** — filters the dashboard to the flagged tasks (`/dashboard?shift=<id>` from Attendance); tapping
  one opens the existing edit sheet (new time and/or person).

**Never auto-moved**: started, paused and finish-requested tasks, meetings and protected tasks — listed as "Move
yourself". `unmovableReason` (now in `scheduling/unmovable.ts`, client-safe) gained `paused` and `finish-requested`,
which the leave shift now honours too: a paused task is work under way, like a started one.

Moved tasks notify the assignees and their Team Leaders (TASK_SHIFTED) with `exceptUserId` = the Admin who shifted.

### "Ask tomorrow" and the morning job

`src/jobs/back-question.ts` (every 30 min; cron route list, `vercel.json`, README, inline runner): on each company
working day (working weekday, not a holiday), from 2 hours before work starts, every active ASK early leave with
`backOn = null`, no question waiting and `coveredThrough < today` gets `askDay = today` and a BACK_QUESTION to
Admins and HR. The card "Is <Name> back today?" (Back / Still off) sits at the top of Requests (Admin; counted in
the Requests badge) and Attendance (HR and Admin).

- **Back**: `backOn = askDay`; no more questions; covered days stay as they were.
- **Still off**: `coveredThrough = max(askDay, today)` — that day is covered (and flags its tasks; Admins get an
  EARLY_LEAVE "<Name> still off · N tasks need shifting") — and the job asks again the next working morning.
- Answering or cancelling marks that question's BACK_QUESTION feed rows read.

While a question is unanswered the asked day is not covered: the person counts as available until someone says
"Still off".

### Notifications

New kinds `EARLY_LEAVE` (to Admins and HR minus the actor; HR's copy adds "Admin will shift these") and
`BACK_QUESTION` — both amber, in the feed's **People** group (and its filter). They have no task or invoice, so the
TEAMS / CLIENTS rows do not narrow them (`isUnscopedPeopleKind`). Taps: Admin → dashboard (EARLY_LEAVE) or Requests
(BACK_QUESTION); HR → Attendance. Phrases live in `notification-text` (`earlyLeftPhrase`, `stillOffPhrase`,
`backQuestionPhrase`).

## Consequences

- One more input to `personDayStatus`; `DayKind` gains `AWAY` (Day view status `AWAY`, HR tile "Away", grid "AW").
- `shiftTaskToNextSlot` keeps its behaviour; its save-and-notify half is `applyTaskMove`, shared with the early-leave
  shift.
- The leave shift now also leaves paused and finish-requested tasks for their owners ("Move yourself").
- Team Leaders and Executives see no flags: shifting is Admin's decision. A later ADR may show them "your task may
  move".
