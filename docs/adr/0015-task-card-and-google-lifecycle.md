# ADR 0015 — Task card, Google lifecycle until delete, Meet for every task, Gemini notes in Drive

- Status: Accepted
- Date: 2026-10-10
- Numbering: filed as 0015 because 0013 and 0014 are already used on the parallel finance / Client-kit branch
  (invoice file names, Client kit).
- Supersedes: SPEC §7 "Meet link deactivated" on approve, SPEC §8 "Meeting-type tasks only run step 2", SPEC §12
  delete checkboxes, SPEC §5.1 pill columns, §5.2 row colours / assignee chip / "Today" date chip, §5.4 green filter
  rows + bottom bar; ADR 0010's ★ Important chip; ADR 0008's
  amber `pref:` chip on the card; ADR 0012's add-task summary line and "Inviting …" card.
- Extends: ADR 0003 (Google integration), ADR 0008, ADR 0012

## Context

The owner described the task card and its Google side in one go: the (i) sheet should say who the task is with; the
card should not; every task — work or meeting — gets a Drive folder, a Meet link anyone can join and (for work) a Chat
space with the whole team, and all of it lives until the task is deleted, when everything goes. Gemini should take
notes in every call and the notes should land in the task's Drive folder. Row colours were redefined, the circle should
work like Google Tasks, and a few add-task pieces (★ Important, Protected, the summary line / card) were dropped.

## Decisions

### Lifetime: until delete
- Approving / completing a task no longer touches Google. `deactivateMeet` and `Cal.endEventAndRemoveMeet` are gone;
  completed tasks keep an active Meet icon, Drive folder and Chat space.
- **Delete = everything** (`deleteTask(taskId)` in `src/server/tasks/manage.ts`, `teardownTask` in
  `src/google/task-integrations.ts`): pending Google jobs for the task are cancelled; the Meet space is made unusable
  (Meet API `spaces.endActiveConference` + `spaces.patch config.accessType = RESTRICTED` — Google cannot delete a Meet
  link); the Calendar event is deleted (`sendUpdates: all`); the Drive folder goes to the **Drive trash** (recoverable
  30 days); the Chat space is deleted; sessions, requests, attachments / voice notes, filed meeting notes and the
  description are deleted. The row stays as an invisible **tombstone** (id, title, client, `deletedAt`, `deletedById`)
  so the audit log and restart links still resolve; every Google id on it is cleared.
- A Drive folder or Chat space still used by another live task (a restart that reused the workspace when
  `restartCreatesNewWorkspace` is off) is kept and reported in the audit entry.
- Each Google step is independent; failures are returned as `warnings` (the dashboard shows them in an error toast) and
  never block the delete.
- `DeleteTaskSheet` shows exactly what will be removed (Calendar event · Meet link · Drive folder and files · Chat space
  · task details; items the task doesn't have are left out) and one **Delete everything** button.

### Meet for every task, open to anyone with the link, Gemini notes on
- Every task's Calendar event is created with `conferenceData.createRequest` (hangoutsMeet) as before — work tasks
  always have a scheduled slot, so they always get one; a meeting only lacks Meet when its organiser switched Meet off
  in Options (ADR 0012).
- New queue job **`MEET_CONFIG`** (enum value, queued by `CALENDAR_EVENT` and by `CALENDAR_UPDATE` when Meet is switched
  on; idempotency key `meetcfg:<task>:<meeting code>`): `configureTaskSpace(meetLink)` in `src/google/meet.ts` looks the
  space up as `spaces/{meetingCode}` and patches `config.accessType = OPEN` (anyone with the link joins without
  knocking), `config.artifactConfig.smartNotesConfig.autoSmartNotesGeneration = ON` (Gemini "Take notes for me") and
  `transcriptionConfig.autoTranscriptionGeneration = ON`. If the artifact fields are refused it retries with notes only,
  then access only. Every refusal is a **warning in the job result** (and `console.warn`); the job itself succeeds.
  The space name is stored in `Task.meetSpaceName`.
- **Scopes** (`MEET_SCOPES` in `src/google/client.ts`, `DWD_SCOPES` = everything delegation must list):
  `meetings.space.created`, `meetings.space.settings` (patching spaces the organiser owns but the app didn't create —
  Calendar-made links), `meetings.space.readonly` (conference records, smart notes, transcripts). They are requested
  with a **separate token** (`getMeetJwt`) so a delegation that doesn't include them yet only disables the Meet extras —
  Drive / Calendar / Chat keep working. README lists them under domain-wide delegation; the Meet REST API must be
  enabled in the Cloud project.
- **Caveat:** Gemini note-taking only happens on a Workspace edition that includes Gemini in Meet, and the organiser —
  `GOOGLE_IMPERSONATE_USER`, whose calendar owns every task event — must be licensed for it. Otherwise the space is
  still opened and the warning says why notes are off.
- `GOOGLE_MOCK=true` simulates all of it in memory (`mockMeet`): configure → OPEN + notes; lock → RESTRICTED + ended.

### Meeting notes → the task's Drive
- Every task's Drive folder gets a **"Meeting notes"** subfolder (`Task.meetNotesFolderId`). **Meetings now get a Drive
  folder too** (queued `DRIVE_FOLDER`; still no Chat space).
- Folder name = **the task title**; the existing short id suffix (`" – abc123"`) is added only when the name is already
  taken in the parent (another task of the client with that title, or a folder of that name in Drive).
- The parent path is chosen in ONE function, `taskFolderParent(task)` in `src/google/task-folder.ts`
  (`["Clients", <client>]` today). Pointing task folders at the Client kit's per-client "Work" folder later is a
  one-line change there. `ensureTaskFolder` is shared by the queue, the Drive icon and uploads.
- New job **`meeting-notes`** (registry + inline runner every 30 min + `vercel.json` `*/30 * * * *`): for live tasks
  with a Meet space whose start has passed and whose end is within the last 30 days (Meet keeps conference records for
  30 days), list `conferenceRecords` (`filter: space.name = "<space>"`, ended calls only), their `smartNotes` and
  `transcripts` in state `FILE_GENERATED`, and file each Doc into "Meeting notes": **move** (re-parent) when the
  organiser may, else add a **Drive shortcut**. Filed Docs are recorded in the new table **`TaskMeetingNote`**
  (`taskId`, `kind` SMART_NOTES | TRANSCRIPT, `conferenceRecord`, `docId`, `docUrl`, `filedAs` MOVED | SHORTCUT, unique
  `(taskId, docId)`) so runs are idempotent. Per-task errors become warnings in the job result.
- Mock mode: one Gemini notes Doc per space once the task's scheduled end has passed.
- The (i) sheet lists filed notes ("Gemini notes · 08 Oct") and links the "Meeting notes" folder.

### Chat space / Drive sharing people (`workTaskPeople` in `src/server/tasks/task-people.ts`)
- **Chat members + Drive sharing** for work tasks: the assigned people + the Team Leader of the task's team(s) (and an
  assignee's own Team Leader for team-less legacy rows) + **every active executive of those teams** + the creator.
  Never external guests. (Admins other than the creator are no longer added automatically.)
- **Calendar attendees** for work tasks: assigned + those Team Leaders + creator + Admins — unassigned executives are
  not invited, so their free/busy (which feeds the slot finder) stays free.
- Meetings are unchanged (ADR 0012): organiser + internal invitees + guests on Calendar; internal ones on Drive.

### Card layout (`TaskRow`, `RowParts`, `format.ts`; prototype `taskRow`)
- Compact card (≈120px instead of ≈160px), 10px padding:
  1. title (2 lines max) + badges (⟳ recurring, ⏸ paused, amber **"?"** doubt, ⚠ integration error) · the circle
     top-right;
  2. client chip + **team chip** (one line, truncating; "Social +1" for several teams; teal `--team` / `--team-bg`) ·
     **date pill** ("08 Oct", never Today / Tom / Yest — `datePill`) + **hours pill** ("4hrs"; meetings "🎥 30m" — no
     separate "Meeting" chip; under an hour always "30m");
  3. the five icons at 32px (+ voice notes) · the **scheduled time pill**;
  4. only once started: the right-aligned **actual pill** "▶ 10:05am – …" (green / red, below).
  Pills are 24px with 11.5px tabular text.
- Removed from the card: the assignee chip ("Me" / "GR" / "Sana"), the amber `pref:` chip, the Team Leader's
  lowercase assignee names, the ★ star, the "Meeting" chip.
- The (i) sheet has an "Assigned to" block: Team, Team Leader, Assigned, Admin's preference (meetings: Invited), plus
  the filed meeting notes.
- Drive and Meet icons work for meetings and for completed tasks.
- Doubt: the whole card turns **purple** (light: soft lavender + violet edge; dark: violet tint) with a violet "?" badge.

### Review per pill (`review.ts`, `review-fields.ts`, `PillReviewSheet`; migration `20261010220000_task_review_fields`)
- `Task.reviewFields String[]` ("date" = start date, "time" = start time, "mins" = time allotted) and `Request.field`.
  `reviewRequested` mirrors "any field flagged". The migration maps the old single flag to `["mins"]` (and open
  REVIEW / TIME_CHANGE requests to `field = "mins"`).
- Long-press (450 ms) / right-click / Shift+F10 on the date, hours or start-time pill opens the pill menu (pill
  gestures stop at the pill: no card menu, no circle, no text selection or iOS callout; a tap still opens (i)):
  - Team Leader (any visible task) / Executive (own tasks): **Request review of the …** (optional note) → red dot on
    that pill for everyone + a REVIEW request with the field in Admin's Requests (the inbox shows "Review request ·
    start date") + 🔔 for Admins; asking again changes nothing. **Withdraw review of the …** removes the dot and
    resolves their open request(s) for it ("Withdrawn").
  - Admin: **Mark the … reviewed** (dot gone, open requests for that pill resolved, requester notified) · **Change the
    …** (opens Edit; saving any edit clears every dot, as before) · **Flag the … for review** (dot only, no request).
  - Everyone: **All task actions**.
- The old long-press "Raise review request" / "Raise time-change request" still work and land on the time-allotted /
  start-time pill. Resolving a request in the inbox removes only that pill's dot (Admin's own flags stay).
- The strip's red-dot filter = tasks with any pill under review. The demo seed has "[demo] Robam reel cut" with all
  three dots.

### Dashboard top summary + bottom filters (`summary.ts`, `TimeStatus`, `BottomBar`; prototype `pillGroups`, `.sumsec2`, `prow`)
- The cyan zone (prototype `.sumtop` / `.sumsec2` / `.sch`) is a caption row — "OPEN HOURS" and, on the right, the
  active filters ("Social · Zenith Foods · Tomorrow") or "all tasks" — then ONE line per group: a 54px muted uppercase
  label (Admin **TEAMS**, or "**<TEAM>·PEOPLE**" — its Team Leader + executives — once a team is picked; Team Leader
  **PEOPLE** (their executives); Executive **DAYS** (Today / Tom / Day+2); everyone **CLIENTS**) and one sideways-
  scrolling row of content-sized 30px chips "Social **11.8h** (8)" (name, hours — "30m" under an hour —, open task count)
  in the add-task capacity cell colours. Chips without open tasks are hidden unless selected. Tapping a chip filters
  the list (tap again to clear).
- The numbers are computed on the client from the tasks matching the **bottom** filters (team / person / client, client /
  work, day) — not the strip, not the summary's own selection — open tasks only; hours count work tasks (meetings count
  as tasks, not hours). The server no longer builds pills (`buildPills` / `DashboardData.pills` removed).
- Bottom filters (prototype `prow` / `.plab`): the green look is gone — the strip, then **neutral glass one-tap rows**:
  "TEAMS" (TL: "PEOPLE", Executive: "CLIENTS") and "CLIENTS" (Executive: "WORK"), each a small uppercase muted label +
  "All" + one 32px pill per item (single line, the row scrolls sideways; tap again to clear), then the bar: 📅 (date —
  "Which day?" sheet: Any day / Today / Tomorrow / Oldest first / a date), **Today**, **Tomorrow**, **Oldest** on the
  left; the Meet icon (add a meeting) and a blue **+** (add a task) on the right. No horizontal page overflow at 390px.

### Admin "⏸ all" (`bulk.ts` `pauseResumeMany`, `pause-core.ts`, `PauseAllSheet`; prototype `pauseAllSheet`)
- Admin only, first item of the status strip (swatches are 30px so the strip fits 390px). The sheet acts on the open
  tasks the dashboard filters currently show: "Open, running N" / "Already paused M", an optional reason, **Resume all
  (M)** and amber **Pause all (N)**.
- Server: zod (1–500 ids, PAUSE | RESUME, reason ≤ 500), Admin only, every id must be a visible, non-deleted task
  (else nothing changes), tasks that can't take the transition are skipped and counted; one transaction with the same
  writes as single pause / resume (`pause-core.ts`, now shared by `pauseTask` / `resumeTask`); one audit entry per
  task (`task.pause_all` / `task.resume_all`); assignees notified with the reason; resume re-syncs the Calendar event.

### Colour rules (`state.ts`)
- **Row** (`rowColour(t, now)`), precedence: completed → **faded card** (opacity, no grey fill, no edge) > doubt raised
  → **purple** (`--row-purple`, `--acc-purple`) > PAUSED → **yellow** > STARTED / FINISH_REQUESTED → **green** > not
  started and the scheduled start has passed → **red** (work tasks; meetings aren't started) > neutral. A started task
  that runs past its end stays green as a row.
- **Actual-time pill** (`actualTone`, minute precision): finished (finish requested or completed) on / before the
  scheduled end → green, after → red; running past the scheduled end → red; started after the scheduled start → red;
  started on time → green. Text colours `--ontime` / `--late`, legible in light and dark.
- The scheduled pill is red while a task is late to start.
- `isOverdue` (the overdue job's notifications) is unchanged except that FINISH_REQUESTED is no longer overdue
  ("done from my side"); it no longer drives the row colour.
- Filter strip swatches (34px): red "Late to start", yellow "Paused", green "Started", purple "?" "Doubt raised". The ⏸
  toggle is gone (yellow is paused); saved `pausedOnly` / `icons: paused | important` prefs are dropped on load.

### The circle works like Google Tasks (`circle.ts`, `completeFromMySide`)
- **Tap** = done from my side: Admin → completes directly (APPROVE_FINISH, now also from DRAFT / ASSIGNED / STARTED);
  Team Leader → REQUEST_FINISH (now also from ASSIGNED); Executive → REQUEST_FINISH on tasks assigned to them
  (`can.requestFinish` includes executives; the server checks the assignment). Paused / completed / already requested
  tasks don't change; a toast says why.
- The tap is **deferred**: the circle shows a tick and a toast "… · UNDO" stays for 5 s; Undo (or tapping the tick
  again) cancels; otherwise `completeFromMySide` is called. Pending taps are sent on `pagehide` / unmount
  (`PendingCommits`, pure and unit-tested). No server-side undo is needed and nobody is notified about a tap that was
  undone.
- **Long-press** the circle (450 ms; a ring fills while holding) or **right-click** it, or Shift+F10 / the context-menu
  key while it (or anything in the card) has focus, opens the task action menu. Right-click anywhere on the card opens
  it too. A hold swallows the click that follows, so tap and long-press never both fire.
- The action menu: Admin "Mark complete" / "Approve finish", Team Leader / Executive "Done from my side" — the same
  Undo flow. "Mark protected / unprotected" and "Request fix for self-assigned task" were removed (no Protected in the
  UI; the column and existing protected behaviour stay).

### Add task / dashboard
- The add-task tag rows (PREFER / WORK / TEAM / EXEC / CLIENT / START) and its bottom bar (📅, upnext / Tom / today,
  Meet, Work, ×) use the same neutral glass as the dashboard rows: glass background, fixed muted uppercase labels,
  32px pills, ink-filled when picked (a preferred executive gets an inner ring). Messages say "in the rows below".
- No ★ Important chip (work or meetings) and no Important checkbox in Edit; new tasks save `important = false`. The
  column stays.
- The schedule line ("📅 Next free slot: …") and the "Goes to … / preference / specialists" and "Inviting … / Guests"
  cards are gone. A missing team / work type / client / invitee is shown in one line next to Save (and as before in a
  toast). The server still picks the next free slot on save.
- Green-row labels (START, CLIENT, …) stay put; only the pills scroll.
- Dashboard: the "Work" pill is gone — Meet icon = add a meeting, + = add a task (see the dock above).

### Data
- Migration `20261010210000_task_meet_notes`: `Task.meetSpaceName String?`, `Task.meetNotesFolderId String?`, enum
  `MeetingArtifactKind`, table `TaskMeetingNote`, `IntegrationKind.MEET_CONFIG`.
- Migration `20261010220000_task_review_fields`: `Task.reviewFields String[]`, `Request.field String?` (+ backfill).

## Consequences
- Real Google needs: the Meet REST API enabled, the three `meetings.space.*` scopes in domain-wide delegation, and a
  Gemini-capable Workspace licence for the impersonated organiser for notes. Without them tasks work as before and the
  `MEET_CONFIG` / `meeting-notes` results carry warnings.
- Things only real credentials can confirm: whether `spaces.patch` is accepted on Calendar-created spaces with
  `meetings.space.settings`, whether `endActiveConference` is allowed on them, and whether the notes Docs can be moved
  (else they're shortcut).
- Deleting a task can no longer keep its Chat or Drive; Drive's trash is the safety net for 30 days.
- Admins who didn't create a work task are no longer Chat members / Drive editors by default (they still get the
  Calendar invite and see everything in the app).
