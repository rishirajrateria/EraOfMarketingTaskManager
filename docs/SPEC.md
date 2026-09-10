# Build Prompt — Company Task Manager Web App

You are building a production-ready, mobile-first task management web app for a marketing agency. It is modelled on Google Tasks but adds hierarchy, time-based scheduling, capacity (sellable hours) tracking, deep Google Workspace integration, and an admin back-office (client vault, invoicing, expenses, attendance, inventory). The complete UI/UX has been designed in Canva (screenshots will be supplied) — reproduce that layout faithfully.

Build everything described below. Where a detail is marked **[ASSUMPTION]**, implement it as stated but make it configurable by the Admin in a Settings screen.

---

## 1. Tech stack

- **Frontend + backend:** Next.js (App Router) with TypeScript, Tailwind CSS. Single codebase, server actions / route handlers for the API.
- **Database:** PostgreSQL with Prisma ORM.
- **Auth:** NextAuth (Auth.js) with Google provider, restricted to the company's Google Workspace domain. Request incremental OAuth scopes for Calendar, Drive, Meet (via Calendar conferenceData), Google Chat, Gmail (send), Sheets.
- **Google APIs:** Calendar API, Drive API, Google Chat API, Gmail API, Sheets API. Use a service account with domain-wide delegation for server-side actions (creating Chat spaces, Drive folders) so tasks are not tied to whoever created them.
- **Background jobs:** a job runner (Inngest or BullMQ with Redis) for: scheduled/recurring invoices, recurring task generation, overdue detection (turns rows red), Meet deactivation on task close, notification dispatch, nightly inventory recalculation.
- **PWA:** installable on Android/iOS with service worker, offline shell, web push notifications.
- **Voice:** in-browser MediaRecorder for voice notes (stored in the task's Drive folder), Web Speech API (or a server STT fallback) for voice-to-text.
- **PDF:** server-side invoice/receipt PDF generation.
- **Hosting:** Vercel (or any Node host) + managed Postgres (Neon/Supabase) + Redis if BullMQ.
- **Layout:** mobile-first at ~390px matching the Canva design exactly; on desktop, centre the same layout in a max-width column (~480px) with the task list scrolling — no separate desktop design.

---

## 2. Roles and permissions

Four roles: **Admin**, **Team Leader**, **Executive**, **HR**.

| Capability | Admin | Team Leader | Executive | HR |
|---|---|---|---|---|
| Dashboard (task list) | Full: all tasks | Own team's tasks + own | Own tasks only | No task dashboard |
| Assign task to Team Leader | ✔ | ✖ | ✖ | ✖ |
| Assign task to Executive | ✖ (only via Team Leader) | ✔ (own team) | ✖ | ✖ |
| Self-assign task | ✔ | ✔ | ✔ | ✖ |
| Start task (long-press → Start) | ✔ | ✔ | ✖ | ✖ |
| Request finish (tap circle) | ✔ | ✔ | ✖ | ✖ |
| Approve finish | ✔ | ✖ | ✖ | ✖ |
| Pause / resume task | ✔ only | ✖ | ✖ | ✖ |
| Edit task (long-press → Edit) | ✔ | ✖ (raise request instead) | ✖ | ✖ |
| Delete task (long-press → Delete) | ✔ | ✖ | ✖ | ✖ |
| Raise doubt (yellow) | — | ✔ | ✖ | ✖ |
| Raise review/time-change request (red dot) | — | ✔ | ✔ (on own tasks) | ✖ |
| Restart completed task | ✔ | ✔ | ✖ | ✖ |
| Schedule a meeting | ✔ | ✔ | ✔ | ✖ |
| Menu tray (back-office) | ✔ only | ✖ | ✖ | ✖ |
| Attendance dashboard | ✔ | ✖ | ✖ | ✔ |
| Approve leave | ✔ | ✖ | ✖ | ✔ (changes to already-approved items need Admin) |
| Client vault access | ✔ + whoever Admin grants | granted only | granted only | ✖ |
| Invoice/finance read access for CA | Admin grants a "CA" read-only user | | | |

Admin's own self-assigned tasks can never be overlapped or moved by anyone. Team Leader / Executive self-assigned tasks may be overlapped or rescheduled by their superior; if the owner wants such a task protected/fixed, they raise a request to Admin.

Every approval-changing action follows: **anything that was already approved can only be changed with Admin approval**.

---

## 3. Data model (Prisma — extend as needed)

- `User` — googleId, email, name, avatar, role (ADMIN/TEAM_LEADER/EXECUTIVE/HR), teamId, teamLeaderId (for executives), dailyCapacityMinutes (override), workingDays, active.
- `Team` (= Designation) — name (graphic, finance, website, video, write, …), leaderId. Admin-managed via "Add Designation".
- `Client` — name, contact, email, gstNumber, address, driveFolderId (client root folder), visibleInFilters (true once any task exists for it).
- `WorkType` — admin-managed pill labels ("Add Work"): e.g. Pharma bag, Robam… used as tags/categories.
- `Task` — title, description (rich text), type (WORK/MEETING), clientId, teamIds[], assigneeIds[], createdById, assignedById, allocatedMinutes ("4hrs"), scheduledStart, scheduledEnd, actualStart, actualEnd, status, colourState (derived), important (star), tags[] (WorkType ids), priority, recurrenceRuleId, parentTaskId (for restarts/duplicates), driveFolderId, meetLink, calendarEventId, chatSpaceId, pausedAt, pausedTotalMinutes, doubtRaised (bool + note), reviewRequested (bool + note), finishRequestedAt, approvedAt.
- `TaskSession` — taskId, startedAt, endedAt (for pause/resume accounting).
- `TaskAttachment` — taskId, driveFileId, kind (FILE/VOICE_NOTE/IMAGE), durationSec.
- `RecurrenceRule` — frequency (DAILY/WEEKLY/MONTHLY/CUSTOM), interval, byWeekday, endDate | infinite, nextRunAt.
- `Request` — type (DOUBT/REVIEW/TIME_CHANGE/FIX_SELF_TASK/FINISH/LEAVE/APPROVED_CHANGE), taskId?, raisedById, targetRole, note, status (OPEN/RESOLVED/APPROVED/REJECTED), resolvedById.
- `ClientVaultItem` — clientId, kind (ASSET_DRIVE_LINK/CREDENTIAL/SHARED_DRIVE_LINK), label, url, username, password (encrypted at rest), notes.
- `VaultAccessGrant` — vaultItemId, userId, expiresAt (absolute) OR expiresAfterFirstOpenMinutes, firstOpenedAt, revoked.
- `Invoice` — clientId, number, items[] (description, qty, unit HOURS/FIXED, rate, amount), subtotal, gst%, total, kind (ONE_TIME/RECURRING), schedule (RecurrenceRule), paymentMode (FULL/ADVANCE), advancePercent, dueDate, status (DRAFT/SCHEDULED/SENT/PARTIALLY_PAID/PAID/OVERDUE), pdfDriveFileId (client folder), pdfBackendFileId, sentAt.
- `Payment` — invoiceId, amount, receivedAt, method, receiptPdfId, receiptSentAt.
- `Expense` — date, amount, category, vendor, note, receiptImageDriveId, voiceNoteDriveId, createdById.
- `Attendance` — userId, date, checkIn, checkOut, status (PRESENT/ABSENT/HALF_DAY/LEAVE/HOLIDAY), markedById.
- `Leave` — userId, from, to, reason, status (REQUESTED/HR_APPROVED/ADMIN_APPROVED/REJECTED), calendarEventId.
- `InventorySnapshot` — teamId/userId, date, capacityMinutes, assignedMinutes, sellableMinutes.
- `CompanySettings` — company name, address, GST, bank details, logo, working hours, working days, lunch break, holidays[], invoice numbering prefix.
- `AuditLog` — every state change with actor, before/after.

---

## 4. Authentication and onboarding

- Google sign-in only, restricted to the company Workspace domain.
- Users do not self-register. Admin adds people from the menu tray ("Add Executive", "Add Team Leader"; HR added via the same screen with role HR) by typing their Workspace email, choosing role, team, and (for executives) their team leader. On first sign-in the account is matched by email and activated. Unknown emails are rejected at login.

---

## 5. Dashboard (all task roles)

Screen is three stacked zones exactly as in the Canva design:

### 5.1 Top blue area — "time status" visualisation
Shows **assigned (allocated) hours** as pills. Every pill is tappable and filters the task list below.
- **Admin:** three columns — by Team (Graphic 5.5 Hr…), by Person (Rishi 5 Ho…), by Client (Repo 5.5 Hr…).
- **Team Leader:** by Executive in their team (Arush 5.5…), by Date (Today, Tomorrow, B4Leave, All time), by Client.
- **Executive:** by Date (Today, Tomorrow, B4Leave, All time) and by Client.
- "B4Leave" = hours assigned before the user's next approved leave.
- Above the pills sits a **filter strip** for row colour (grey/green/white/yellow/red) and icon states (paused, doubt, review-requested, important). Do not omit this.
- Values are the sum of `allocatedMinutes` of non-completed tasks in the current filter scope. **[ASSUMPTION]** default period = all open tasks; the date pills narrow it.

### 5.2 Middle — task list rows
Each row shows: title; client chip; team/assignee chip (e.g. "Me", "GR", "we" for multi-team); the `i` icon (opens task detail); Drive icon (opens task Drive folder); Meet icon (opens task Meet link, disabled once closed); Chat icon (opens task Chat space); Calendar/Meet icon; allocated time ("4hrs"); scheduled start and stop times (a second line shows actual start/stop once recorded); date chip (Today / Yestr / date); the **completion circle** on the right. On Team Leader dashboard the assignee's name is printed beside the row.

Row colour = task state:
- **White** — assigned, not started.
- **Green** — started / ongoing (timer running).
- **Yellow** — doubt raised by Team Leader (awaiting Admin).
- **Red** — overdue: scheduled start passed without starting, or scheduled end passed without finish.
- **Grey** — completed (approved). Shows the purple circular-arrow **Restart** button in place of the circle.

Row icons/badges:
- **Pause icon (⏸)** — task is paused by Admin. Everyone assigned sees it.
- **Red dot** — a review/time-change request is pending on this task (raised via long-press). Admin sees the dot, contacts the person, then edits the task; editing clears the dot.
- **Star** — marked important.
- **Yellow circle** on the right = doubt flag (matches row colour).

### 5.3 Long-press action sheet (per role)
- **Admin:** Start, Request finish, Approve finish, Pause/Resume, Edit, Restart (if completed), Delete, Resolve doubt, Open request.
- **Team Leader:** Start, Request finish, Raise doubt, Raise review/time-change request, Restart (if completed), Request fix for self-assigned task.
- **Executive:** Open details, Raise review/time-change request (own tasks only).

### 5.4 Bottom green area — filters (dashboard mode)
Two rows of pills + a bottom bar exactly as designed:
- Row 1: **Admin** → All + Teams; **Team Leader** → All + Executives; **Executive** → All + Clients.
- Row 2: **All + Clients** (clients appear only once at least one task exists for them) — for Executive this row shows work types.
- Bottom bar: calendar icon (date picker), quick pills **Ascending / Tomorrow / Today**, a **"completed"** toggle, a recurring-tasks toggle, pause filter, colour swatches, then the **Google Meet icon** (opens Add flow pre-set to Meeting), **Work** (opens Add flow pre-set to Work), and **+** (opens Add flow with the Work/Meeting choice).
- Filters combine (AND) across rows and persist per user.

---

## 6. Add-task flow (after tapping +, Work or Meet)

Full-screen sheet matching the "after clicking +" design:
- Blue area switches to **Today / Tom / Week / Month – X Hours – N** where hours = allocated hours in that period for the chosen assignee and N = task count. Updates live as fields are filled.
- Step 0: choose **Work** or **Meeting** (skipped when opened from the Work or Meet shortcut buttons).
- Fields: Title; big **description box** (rich text) with mic → voice-to-text; separate **voice notes** recorded via mic (shown as the "20s" waveform bars, multiple allowed, playback inline); **Star** (important); **Loop** (recurrence: Daily / Weekly / Monthly / Custom; end date or Infinite); **Upload** (creates the task's Drive folder immediately if not yet created and opens a picker to upload into it); Client (mandatory); Assignee(s) (mandatory — Admin picks Team Leaders, Team Leader picks Executives, anyone may pick self); Team(s); allocated time; scheduled date + start/stop time (optional → auto "next available slot"); priority; send button (paper plane) creates the task.
- Bottom green area switches to **tag mode**: the pills are now Admin-defined tags/labels — Work types, Teams, Clients — tapping toggles them onto the task. Bottom bar shows date shortcuts **Upnext / Tom / Today**, and the **X** to cancel.
- **Work** creates the full set (Section 8). **Meeting** creates only a Calendar event with Meet link for the chosen attendees and time — no Drive folder, no Chat space, no task row time-tracking (it still appears in the list as a meeting row).
- Multi-assignee / multi-team tasks are one record shown on every assignee's dashboard with a single shared completion state.

---

## 7. Task lifecycle (state machine)

```
DRAFT → ASSIGNED(white) → STARTED(green) → FINISH_REQUESTED → COMPLETED(grey)
             ↑ ↓ PAUSED (admin only, from any active state)
             ↑ DOUBT(yellow) raised by Team Leader, cleared by Admin
   any active state → OVERDUE(red) by scheduler if times missed (colour overlay, status unchanged)
   COMPLETED → RESTART → new duplicate task in ASSIGNED
```
- **Start:** Team Leader (or Admin) long-presses → Start. `actualStart` recorded, a `TaskSession` opens, row turns green.
- **Pause (Admin only):** closes the session, freezes the clock, marks paused; Executive and Team Leader are notified. Resume opens a new session. Paused time is excluded from actual duration; scheduled end shifts forward by paused duration.
- **Finish:** Team Leader taps the circle → status FINISH_REQUESTED, Admin gets it in the Requests inbox and as a badge on the row. Admin approves → COMPLETED, `actualEnd` recorded, row grey, Meet link deactivated, Chat space kept (until deletion). Admin may reject → back to STARTED with a note.
- **Doubt:** Team Leader long-press → Raise doubt with note; row yellow; Admin replies (chat/call/edit) and taps Unflag; can be raised again.
- **Review / time-change request:** long-press → request with note; red dot on row; Admin edits task (times etc.), which clears the dot.
- **Restart (completed tasks):** creates a duplicate with the same title, description, client, assignees, tags, allocated time; times reset (scheduled to next available slot); new Drive folder, Meet and Chat space **[ASSUMPTION]**; the old task keeps its purple restart button and links to the duplicate via `parentTaskId`.
- **Overdue:** a job runs every minute; if `now > scheduledStart` and not started, or `now > scheduledEnd` and not finished, set red overlay and notify assignees + superior.

---

## 8. Google Workspace automation per Work task

On creation of a Work task, server-side:
1. **Drive:** create folder `Clients/<Client>/<Task title – id>` shared with assignees, their Team Leader, and Admin (editor). Store id; the row's Drive icon opens it. Voice notes and uploads land here.
2. **Calendar + Meet:** create a Calendar event for scheduled start–end with `conferenceData` (Google Meet), attendees = assignees + Team Leader + Admin. Meet link is stored and remains active until the task is approved complete, after which the event is ended/updated so the link no longer works.
3. **Chat:** create a Google Chat space named after the task, members = assignees + Team Leader + Admin; post a welcome message with task summary, Drive link, Meet link.
4. **Calendar blocking:** the event also blocks the assignee's calendar, which feeds the availability logic.
Task edits (time/assignee) propagate to the Calendar event, Chat membership, and Drive sharing.

**Meeting-type tasks** only run step 2.

---

## 9. Scheduling, capacity and inventory

### 9.1 Working-time defaults **[ASSUMPTION — Admin-editable in Settings, with per-user overrides]**
- Working days: Monday–Saturday; Sunday off.
- Working hours: 10:00–19:00 IST.
- Lunch: 13:30–14:30 (excluded) → **8 productive hours/day** per person.
- Company holidays: Admin-maintained list.
- Timezone: Asia/Kolkata.

### 9.2 Next-available-slot algorithm
When a task is added without date/time (assignee and client are still mandatory):
1. Build the assignee's free timeline from working hours minus lunch, holidays, approved leaves, and existing non-self-assigned tasks/meetings (from the DB and their Google Calendar busy blocks).
2. Find the first contiguous gap ≥ `allocatedMinutes` starting from now, searching forward day by day. Tasks may span days if needed (split into sessions).
3. Self-assigned tasks of a Team Leader/Executive are treated as **soft blocks**: a superior's task may overlap them (the self-assigned task is auto-shifted to the next slot and its owner is notified). Admin's own self-assigned tasks are **hard blocks**.
4. One person works one task at a time (no overlaps in hard blocks).
5. Show the proposed slot to the creator before saving; they can accept or pick manually.

### 9.3 Inventory (sellable hours) — Admin menu tray
- Per person, per team, per day/week/month: `capacity − assigned = sellable`.
- Capacity derives from attendance (present/half-day) and future approved leaves and holidays.
- Views: today, this week, this month, custom range; team totals; a "remaining after current assignments" figure per day.
- **Sudden leave handling:** when a leave is approved for someone with tasks in that window, Admin gets a prompt: "Shift all affected tasks to next available slot" (one tap, runs the slot algorithm for each task in order) or reassign manually. Affected assignees and Team Leader are notified; Calendar events move accordingly.

---

## 10. Requests inbox and notifications

- Admin has a **Requests** screen (badge count in header) listing: finish requests, doubts, review/time-change requests, fix-self-task requests, changes to approved leaves. HR has a **Leave requests** screen.
- Notifications (in-app + web push + Google Chat message in the task space; email optional per user): task assigned, task started, paused/resumed, finish requested/approved/rejected, doubt raised/resolved, review requested, task overdue, task shifted due to leave, leave requested/approved, invoice sent/paid, vault access granted/expiring.

---

## 11. Admin menu tray (Admin only) — independent modules

Opened from the top-left hamburger on Admin's dashboard, exactly as the "menu bar features" design.

### 11.1 Client Assets Drive Links · Client Credentials · Client Shared Drive Links (Client Vault)
- Per client, three tabs. Items: label, URL/username/password (encrypted at rest with a KMS/secret; shown in plain text to users who have access, with a copy button), notes.
- **Access grants:** Admin picks users per item or per client, and sets either **expires at date/time**, **expires N minutes/hours after the user first opens it**, or both. Expired/revoked users lose access immediately. Every view is audit-logged.
- Header "+" = **Add Client** (name, contact, GST, address). A client becomes visible in dashboard filters only once a task exists for it.

### 11.2 Expense (company spend log)
- Entries: date, amount, category, vendor, note, **photo of the bill** (camera/upload → Drive `Finance/Expenses/YYYY-MM`), **voice note** per entry, tags. Filters by month/category; totals; CSV export; Google Sheet sync to a "Expenses" sheet.

### 11.3 Payment Creator (Invoice generator)
- Create invoice for a client: line items (description, quantity, unit = hours × rate or fixed amount), GST %, notes, payment terms, due date; company details/logo/bank details from Settings; auto-numbering.
- **Modes:** One-time or Recurring (daily/weekly/monthly/custom, end date or infinite). **Payment type:** Full, or Advance with selectable advance % (the remainder is auto-generated as a balance invoice on completion or a chosen date).
- **Scheduling:** set send date/time; the job sends the PDF via Gmail from the company account to the client's email with a templated message, saves the PDF to the client's Drive folder and to a backend `Finance/Invoices` folder.
- **Status tracking:** Draft → Scheduled → Sent → Partially paid → Paid / Overdue; partial payments record amount received and balance outstanding.
- **Mark as paid:** enter amount/date/method → generates a receipt PDF and emails it to the client automatically; saves receipt to both Drive locations.
- Generate a clean, professional default invoice/receipt template (company logo, GST-compliant fields, HSN/SAC column, totals in INR, bank details, terms).

### 11.4 Finance sheet
- Dashboard: invoiced vs received vs outstanding per client and per month, expenses per month, net; charts; export. Two-way sync to a Google Sheet ("Finance") so the CA can work in Sheets.
- **CA access:** Admin can grant a read-only "CA" user (Workspace or external Google account) access to Finance sheet, invoices and expenses only.

### 11.5 Attendance
- Also lives as the **HR dashboard**. Staff check-in/check-out buttons (manual); HR/Admin can mark or correct any day; monthly grid per person; statuses present/absent/half-day/leave/holiday; export.
- **Leave flow:** an employee blocks dates in their Google Calendar (or in-app leave form) → HR notified → HR approves/rejects → if approved and tasks fall in that window, Admin gets the "shift tasks" prompt (Section 9.3). Any edit to an already-approved leave requires Admin approval.
- Attendance feeds inventory capacity.

### 11.6 Inventory
As specified in Section 9.3.

### 11.7 Add Executive · Add Team Leader (and HR)
Type Workspace email, pick role, team, reporting Team Leader (for executives), capacity override. Send an invite email. Deactivate/reactivate users.

### 11.8 Add Work · Add Designation
- **Add Work:** manage work-type tags (name, colour). These become the tag pills in Add-task mode and the Row-2 filter pills.
- **Add Designation:** manage teams (name, leader). Designation = Team.

### 11.9 Settings (add this screen)
Company profile, GST, bank details, logo, working hours/days/lunch, holidays, invoice numbering, notification defaults, Google integration status.

---

## 12. Deleting a task (Admin, long-press → Delete)
Confirmation sheet with checkboxes, all pre-checked, individually deselectable:
- ☑ Delete Google Chat space
- ☑ Delete Drive folder and files
- ☑ Delete task data (history, sessions, requests)
- (Calendar event / Meet is always removed.)
Unchecked items are left intact and the task is marked deleted (soft delete) so links remain resolvable.

---

## 13. Recurring tasks
Recurrence rule creates the next occurrence when the current one is approved complete or at the scheduled time, whichever the rule specifies; each occurrence is a full Work task (own Drive/Meet/Chat) **[ASSUMPTION]**; "Infinite" runs until Admin stops it. Recurring items get a loop badge on the row and a filter toggle in the bottom bar.

---

## 14. Non-functional requirements
- Role-based authorisation enforced server-side on every action; audit log of all state changes.
- Secrets (vault passwords) encrypted with an application key; never logged.
- Soft deletes; all Google API calls idempotent and retried with backoff; failures surface as a row badge so Admin can retry.
- Real-time list updates (SSE or websockets) so multiple assignees see status changes instantly.
- Accessible touch targets; long-press with haptic on mobile; pull-to-refresh.
- Seed script with sample teams, users, clients, work types and tasks in every colour state for demo.

---

## 15. Build order
1. Auth, users/roles, teams, clients, settings.
2. Task model, dashboard UI (all three role variants), filters, colour states, long-press sheets.
3. Add-task flow (Work/Meeting), tags, voice notes, next-available-slot.
4. Google integrations (Drive, Calendar+Meet, Chat) with job runner.
5. Lifecycle: start/pause/finish/approve, doubt, requests inbox, overdue job, restart, delete, recurrence.
6. Attendance/HR, leave flow, inventory, shift-tasks-on-leave.
7. Client vault with timed access.
8. Expenses, invoice generator, payments/receipts, finance sheet + Sheets sync, CA access.
9. PWA, push notifications, seed data, deployment.

Deliver each phase as working, tested code with a short README of env vars and Google Cloud setup (OAuth consent, service account, domain-wide delegation scopes).
