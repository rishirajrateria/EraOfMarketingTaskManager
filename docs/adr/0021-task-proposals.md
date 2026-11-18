# ADR 0021 — Team Leader task proposals, reassignment, Executives book meetings only

- Status: Accepted
- Date: 2026-11-10
- Supersedes: SPEC §2 rows "Assign task to Executive" (at creation), "Self-assign task" (Team Leader / Executive work
  tasks) and the Team Leader / Executive part of ADR 0008's "Team Leader / Executive: assignees as validated"
- Extends: ADR 0008 (team-first assignment), ADR 0016 (one requests inbox), ADR 0017 (notifications vs requests),
  ADR 0019 (availability)
- Prototype: `docs/prototype/eom-tasks.html` — `saveProposal`, `approveProposal`, `approvalStart`, `rejectSheet`,
  `withdrawProposal`, `proposalActions`, `proposalCard`, `editAndApprove`, `.row.proposal`, `.propbar`, `assignSheet`,
  `fabItems`, `personName`, `.chip.person`, `prow3`
- Code: `src/server/tasks/proposal-core.ts`, `src/server/tasks/proposals.ts`, `src/server/tasks/create.ts`,
  `src/server/tasks/manage.ts` (`assignExecutives`), `src/server/tasks/manage-notify.ts` (`tellReassigned`),
  `src/server/tasks/assignment.ts`, `src/components/dashboard/{ProposalRow,ProposalActionSheet,ApproveEditSheet,
  AssignExecutiveSheet,proposal-ui,proposal-toast}.ts(x)`, `src/app/proposals.css`, `src/components/requests/*`, migration
  `20261110120000_task_proposals`

## Context
Team Leaders created work tasks that went live at once: they took a slot, counted toward capacity and inventory and
created Drive / Calendar / Meet / Chat items before Admin had seen them. Executives could create work for themselves.
Reassigning an executive replaced every assignee of the task (audit B1), and non-Admin task creation accepted any team
ids (audit B2).

## Decisions
1. **A Team Leader's WORK task is a proposal.** It is stored with the new `TaskStatus.PENDING_APPROVAL` (not `DRAFT`,
   which is an active status). While pending it has **no assignee and no scheduled time**: the TL's preferred slot is
   kept in `requestedDate` (yyyy-MM-dd, company tz; a deadline's due day) and `requestedTime` (HH:mm, optional), a
   picked repeat in `requestedRecurrence`; `proposedById` / `proposedAt` record who sent it. It therefore holds no time
   and counts toward nothing: `ACTIVE_STATUSES` never contained it, and `BOOKED_TASK_WHERE` (inventory, the add-task
   header, the HR tile, the slot finder's capacity), the Admin task dashboard, the overdue and meeting-notes jobs, the
   recurrence spawner and the client portal exclude it explicitly. No Google job is queued (`queueTaskCreation` /
   `queueTaskPropagation` skip it as they skip client tasks). The TL picks no executive (the server refuses one); the
   add form hides the EXEC row and the files / voice notes, captions "Sent to Admin for approval · no time blocked until
   approved", and its button reads **Send to Admin**. TL **meetings are not proposals**.
2. **Admin decides in Requests → Work and on the dashboard.** A `RequestType.TASK_PROPOSAL` row (target Admin) is
   opened with the proposal, so the inbox and the header badge share one count (`requestInbox` / `requestBadgeCount`,
   ADR 0016). The generic resolve refuses it. Admin acts with **Approve**, **Edit & approve** (the edit form prefilled,
   final button "Approve"; `/dashboard?approve=<id>` from the inbox) or **Reject…** (a note is required).
3. **Approve** turns it into an ordinary ASSIGNED task assigned to that TL (the team's current leader if the proposer is
   gone): at the requested day + time when that exact slot is still free (the slot finder, `allowSplit: false`, nobody
   displaced), else the next free time from the requested day (`proposeSlotOnDay`), else Up next (`proposeSlot`) — all of
   which read `personDayStatus` (ADR 0019). A deadline lands on its due day (today when that has passed). Then the
   Google jobs are queued, a picked repeat becomes a `RecurrenceRule`, the request is APPROVED and the TL is notified.
   From then on it is exactly an Admin-assigned task.
4. **Reject** soft-deletes the task (kept for audit with `decidedById`, `decidedAt`, `decisionNote`), marks the request
   REJECTED and tells the TL the note. **Withdraw** (the proposing TL only) soft-deletes it and resolves the request.
5. **Pending tasks are inert.** Start, finish (circle), pause, doubts, reviews, `assignExecutives`, `updateTask`,
   `ensureTaskDriveFolder` and `uploadAttachment` refuse them ("This task is waiting for Admin's approval"). Only the
   proposing TL (and Admin) see the card: another Team Leader of the team and Executives never do. The TL's card is
   dashed grey "Waiting for Admin" with a dashed inert circle, "no time held" and no Drive / Meet / Chat icons; Admin's
   is indigo "Proposal" with Approve / Edit & approve / Reject… pills (`proposals.css` tokens `--row-prop`, `--prop-ink`, `--prop-edge`,
   light and dark).
6. **Assign / Change person** (long-press, work tasks): single select — another executive of the team or back to the
   Team Leader; TL on their own team's tasks, Admin on any. Only the assignees who belong to the caller's team(s) are
   replaced, so on a multi-team task the other team's people stay (**B1**). When someone other than the actor loses
   the task, the old person hears "Task moved to <name>" and the new one "Task moved to you · by <actor>"
   (`TASK_REASSIGNED`); a first hand-off from the TL stays "Assigned to you by <TL>". Drive / Chat / Calendar membership
   follows through the existing propagation jobs.
7. **Team scope (B2).** `planAssignment` forces Team Leader and Executive work to the caller's own team, whatever
   `teamIds` arrive; proposals always carry the TL's team.
8. **Executives book meetings only.** `createTask` refuses their WORK tasks; the + menu (`fabMenu`) and the add form's
   type switch offer Meeting only. They still use "done from my side" and review requests. Their existing
   self-assigned tasks stay as they are.
9. **Admin's cards and filter.** Admin's cards carry a teal person chip — the executive's first name, else the TL's
   (a proposal: its TL). The filter tray gains a **People** row (All + Team Leaders and executives) that filters by
   assignee (`DashboardFilters.row3`, persisted with the other filters).
10. **Notifications** (ADR 0017 feed, Tasks group, scoped by the task's team and client): `TASK_PROPOSED` (to Admins),
    `TASK_PROPOSAL_APPROVED`, `TASK_PROPOSAL_REJECTED` (to the TL) and `TASK_REASSIGNED` (old and new person), always via
    `notify()` with the actor excluded. A waiting proposal's notification opens Requests → Work for Admin.

## Consequences
- The dashboard's open-hours tiles and every capacity number ignore proposals until approved.
- Tests that seeded live TL / Executive work through `createTask` now use `legacyWorkAs` (tests/tasks/helpers.ts),
  which writes such a task directly, placed by the real slot finder.
- The TL cannot edit a proposal after sending it (the prototype's "Edit proposal"); they withdraw and send a new one.
