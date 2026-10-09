# ADR 0008 — Team-first task assignment, work types per team, specialities

- Status: Accepted
- Date: 2026-10-10
- Extends: SPEC §2 (assignment rights), §5.2–§5.4 (rows, long-press, green area), §6 (add-task flow), §11.7–§11.8
- Reference: the owner's working prototype `docs/prototype/eom-tasks.html` (`renderAdd`, `workFor`, `skilled`,
  `assignSheet`, `personForm`, `PAGES.worktypes`, `workForm`)

## Context

Admin used to pick Team Leaders directly and tag the task with any work type. The owner wants Admin to think in teams:
pick the team, pick the kind of work that team does, optionally say which executive they'd *prefer*, and let the
Team Leader decide who actually does it. Work types belong to teams, and people have specialities so both Admin and
the Team Leader can see who is best at a given kind of work.

## Decisions

### Data model (migration `20261010140000_team_work_specialities`)
- `WorkType.teams Team[]` ↔ `Team.workTypes WorkType[]` (implicit many-to-many `_TeamToWorkType`). A work type with no
  teams is a **legacy row available to every team** — existing data keeps working without a backfill.
- `User.specialities WorkType[] @relation("UserSpecialities")` (+ `WorkType.specialists`). Only Executives and Team
  Leaders keep specialities, and they must be work types of the person's team (or legacy ones).
- `Task.preferredAssigneeIds String[] @default([])` — Admin's suggested executives. Purely advisory: never assignees,
  kept when the Team Leader assigns, shown as an amber `pref: arjun` chip while every assignee is still a Team Leader.
- **One Team Leader per team** is enforced in the people and team actions ("<Team> already has a team leader"), and
  `Team.leaderId` is kept in sync with the Team Leader's own `teamId` (creating / editing / deactivating a TL, or picking
  a leader in the team form, which moves that leader into the team).

### Add task (server: `src/server/tasks/assignment.ts`, `create.ts`)
- **Admin**: `teamIds` required ("Pick a team in the green area"); WORK tasks need a work type of those teams
  ("Pick a work type in the green area"; meetings don't). Assignees = the active Team Leader(s) of the chosen teams
  (error "That team has no Team Leader yet (Menu → Add teamleader)"); Admin may add themselves, and meetings may add
  any attendee. `preferredAssigneeIds` must be active executives of the chosen teams. Each Team Leader is notified
  "New task from <Admin first name>: <title> · prefers <names> — assign it from the task" (suffix only with preferences).
- **Team Leader**: assigns self and/or their own team's executives (team membership, or `teamLeaderId` for legacy rows);
  none picked in the UI = the whole team. WORK needs one of their team's work types.
- **Executive**: self only; WORK needs one of their team's work types.
- Only Admin may send preferences. `taskInputSchema.assigneeIds` defaults to `[]`; non-Admin callers still need ≥ 1.
- `taskUpdateSchema` no longer inherits create defaults (zod 4 applies `.default()` even under `.partial()`, which made
  every Admin edit silently reset `type`, `teamIds`, `tagIds`, etc.); it is an explicit partial without defaults.
- Add-task header inventory (`addTaskInventory`): Admin may scope it to any dashboard user, so the client passes the
  preferred executives, else the chosen teams' executives.

### Add task (UI: `AddTaskSheet`, `AddTaskRows`, `AddTaskBody`, `add-task-helpers`)
- Green rows, labelled on the left, top → bottom (owner's revision: TEAM stays fixed directly above CLIENT so it never
  moves; WORK and PREFER appear above it once a team is picked):
  - Admin: **PREFER** ("No preference" + the team's executives, multi, "★ Name", specialists sorted first with " ✓")
    · **WORK** (single select, only the picked teams' work types, auto-selects the first when the current one doesn't
    belong) · **TEAM** (no "All", no Team Leader pills) · **CLIENT**. PREFER and WORK stay hidden until a team is picked;
    PREFER is also hidden for meetings (meetings invite attendees from the people glyph instead).
  - Team Leader: **WORK** · **EXEC** ("me" + team executives, specialists first with " ✓") · **CLIENT**.
  - Executive: **WORK** · **CLIENT**.
- A summary card in the body: "Goes to Priya (TL, Social)", "Your preference: Arjun · the Team Leader decides" or
  "No executive preference · tap names in the PREFER row", "✓ <Work> specialists: …"; for a Team Leader
  "Assigned to …" / "Your whole team · tap names in the EXEC row to pick".
- The details sheet no longer has the Assignees (work), Teams or Work-type sections; the people glyph only appears for
  meetings (attendees).

### Assign executive (`assignExecutives` in `src/server/tasks/manage.ts`, `AssignExecutiveSheet`)
- Long-press → "Assign executive" for Admin (any open task) and Team Leaders (open tasks of their own team). Hint
  "Admin prefers X · you decide" or "Pick who does this task".
- The sheet lists the team's Team Leader ("me (Priya)" for that TL) and executives; "★ " = preferred, " ✓" =
  specialist in the task's work type; pre-selects current executive assignees, else the preferences.
- Server: Admin → members of the task's teams; Team Leader → only tasks whose teams include theirs, and only members of
  their team. Assignees are replaced, `preferredAssigneeIds` kept, `assignedById` set, audited
  (`task.assignExecutives`), newly added people notified "New task from <name>: <title>", `queueTaskPropagation` syncs
  Calendar attendees / Drive sharing / Chat members (same path as `updateTask`), SSE published to old and new viewers.

### Admin screens
- **Add Work**: grouped by team ("SOCIAL · 4"; a work type in several teams appears under each; "Not in any team" for
  legacy rows; "Removed" for deactivated ones). Sheet: Name + Teams pills (≥ 1, validated server-side) + Remove
  (hard delete when unused, otherwise deactivated so task tags survive) / Restore.
- **Add Team**: each row lists its work types.
- **Add Executive / Team Leader**: "Speciality" pills limited to the selected team's work types (re-filtered and pruned
  when the team or reporting leader changes); rows show "✓ Reels" chips or "no speciality set".
- Executive dashboard green row 2 lists only their team's work types (+ legacy ones).

## Consequences

- Admin can no longer create a self-assigned (auto-protected) work task from the add sheet; their work always goes to
  a team's Team Leader. `setTaskProtected` still protects any self-assigned TL/Exec task on request.
- Existing tasks and work types need no migration: legacy work types (no teams) remain usable everywhere until Admin
  assigns them to teams in Add Work.
- The demo seed now has Social and SEO teams (SEO deliberately without a Team Leader), the prototype's eight work types
  with teams, two specialities per executive, and one Admin task waiting for the demo Team Leader with a preference.
