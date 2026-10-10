# ADR 0017 — Notifications are a feed of what happened; Requests are decisions. Call / WhatsApp / Email on the card

- Status: Accepted
- Date: 2026-10-10
- Extends: ADR 0015 (card colours, deep link to a task), ADR 0016 (one requests inbox, top bar badges)
- Supersedes: SPEC §7 "overdue → notify" (one TASK_OVERDUE), the bell rows for bills due and invoices to approve, the
  card's Calendar icon (ADR 0015 "five icons")
- Reference: `docs/prototype/eom-tasks.html` — `NK`, `notifyTask`, `taskTick`, `openNotif`, `PAGES.notifications`, `.nrow`,
  `.nhint`, `contactPeople`, `contactSheet`, `MODE={`, `.cav.mail`, "Add number", "Mobile / WhatsApp"

## Context
The owner found the bell and the inbox doing the same job. They should feel different: **Requests** (inbox icon, red
badge) are things waiting for a decision; **Notifications** (bell, blue badge) are a feed of what happened, nothing to
decide. Each update should look like the task card it is about and open that task when tapped. Separately, people should
be able to call, WhatsApp or email the right people straight from a card — and only the right people: a Team Leader or
Executive must never get the client's phone numbers or email (owner's revision, 10 Oct).

## Decisions

### What is a notification
- `notify()` (`src/lib/notify.ts`) writes a feed row + SSE + push + email (+ Chat). **Decision kinds never get a feed row**:
  `PAYMENT_DUE` (payables job) and `INVOICE_APPROVAL_DUE` (invoice job: parts due, recurring clones, "remind me") go through
  `remind()` — push + email only (`reminderLog` records them for tests). `FEED_HIDDEN_KINDS` also hides any legacy rows of
  those kinds from the feed and the bell count (`unreadNotificationCount`, used by the layout, dashboard and menu).
- When a notification is about a task its `title` is the **short phrase only** ("Arjun started it 5 min late"); the feed
  shows the task title on its own line. Push / email put the task title first. `taskId` / `invoiceId` / `href` are kept
  (`Notification.invoiceId` is new).

### Events (kinds added: TASK_STARTED_LATE, TASK_NOT_STARTED, TASK_PAST_END, TASK_COMPLETED, PAYMENT_RECEIVED)
| Event | Kind | Phrase | To |
|---|---|---|---|
| Start | TASK_STARTED / TASK_STARTED_LATE | "Rishi started it on time" / "… 5 min late" (minute precision vs scheduled start; ≥ 60 → "1 h 20 min") | Admins + Team Leader(s) of the task's teams / assignees (`taskOverseerIds`), not the starter |
| Start passed, not started | TASK_NOT_STARTED (once) | "Not started · was due at 10:00am" ("9 Oct, 10:00am" on another day) | Admins, TLs, assignees |
| End passed, not finished | TASK_PAST_END (once) | "Still not finished · was due to end at 3:00pm" | same |
| Done from their side | FINISH_REQUESTED | "Arush marked it done from their side" | Admins |
| Approve / Admin's circle | TASK_COMPLETED | "Completed · 12 min early" / "· 5 min late" / "Completed on time" (their "done" time if they marked it) | assignees + TLs + creator, not the actor |
| Pause / resume (incl. Pause all) | TASK_PAUSED / TASK_RESUMED | "Paused by Admin · <reason>" | assignees + TLs |
| Doubt | DOUBT_RAISED / DOUBT_RESOLVED | "Rishi raised a doubt" (note as body) / "Doubt cleared by Admin" | Admins / task people |
| Assigned, restarted, repeat | TASK_ASSIGNED | "New task from Admin · prefers Arjun — …", "Assigned to you by Rishi" | as before |
| Time shifted | TASK_SHIFTED | "Moved to 11 Oct, 2:00pm" (+ reason) | assignees + their TLs |
| Leave approved / declined | LEAVE_APPROVED / LEAVE_REJECTED | employee: "Your leave on 17–18 Oct was approved"; Admin / HR (not the decider): "Arush's leave on 17–18 Oct was approved · 2 tasks to move" / "· no tasks affected"; after Shift tasks: "… · 2 tasks moved" | |
| Leave asked / change asked | LEAVE_REQUESTED | "Arush asked for leave on 17–18 Oct" / "… asked to change their leave …" | HR + Admins |
| Part payment / paid in full | PAYMENT_RECEIVED / INVOICE_PAID | "₹10,000 received from Repo · ₹13,600 still due" | Admins (`invoiceId` set) |
| TDS threshold, invoice sent, work on hold / resumed, vault | unchanged kinds | | |

- **Overdue job** (`src/jobs/overdue.ts`) still keeps the `overdue` overlay flag, and now sends the two one-time updates.
  Idempotent: `Task.notStartedNotifiedAt` / `Task.pastEndNotifiedAt` are claimed with a conditional `updateMany` before
  notifying, so overlapping runs never double-send. Paused, done-from-their-side and completed tasks get no past-end
  update; meetings none. "Once per task" holds even if the task is rescheduled later. The migration back-fills both stamps
  from `overdueNotifiedAt` so tasks the old job already announced aren't announced again. `TASK_OVERDUE` /
  `FINISH_APPROVED` are legacy (still rendered).

### Colours, labels, groups (`src/lib/notification-kinds.ts`, pure)
`KIND_META` maps every kind to a tone (card tokens `--acc-green/red/yellow/purple/grey`; feed-only `--n-blue` #2563eb /
dark #3b82f6 and `--n-amber` #ea7a0c / dark #fb923c in `src/app/feed.css`), a label, a lucide icon (Play, Clock, Check,
Pause, CircleHelp, Plus, CalendarDays, IndianRupee, Bell) and a filter group (TASKS · PEOPLE = leave + vault · MONEY =
invoices, payments, TDS, work on hold). Yellow icons use a dark glyph.

### Feed page (`/notifications`, every role; `src/server/notification-feed.ts`, `NotificationFeed`)
- Caption "Updates on tasks, people and money. Things that need your decision are in **Requests**." (Admin →
  `/admin/requests`, HR → leave inbox; other roles get only the first sentence).
- Newest 150 rows grouped Today / Yesterday / "8 Oct" (company timezone). Row: 3px left accent + 32px round icon in the
  tone; line 1 the task title (bold, one line) when tied to a task, else the text; line 2 the phrase (+ the note);
  line 3 "kind label · client · team · time" (invoice rows: the invoice's client); blue unread dot; › when it leads
  somewhere; read rows at 62 % opacity.
- Bottom zone: SHOW All · Unread n · Tasks · People · Money (`?show=`, optimistic like the requests inbox) and **Mark all
  read** · **Task list** (HR: Leave inbox; CA: Profile).
- Tap = mark read, then go to `notificationTarget()`: task → `/dashboard?task=<id>` (`&completed=1` for a completed task,
  nothing for a deleted one, nothing for HR / CA); invoice → `/admin/invoices/<id>`; leave → Admin `/admin/requests?tab=HR`,
  HR the leave inbox, others `/leave`; otherwise the stored href.

### Dashboard deep link (`src/components/dashboard/deep-link.ts`)
`?task=<id>`: if the card is on screen it scrolls to the centre, flashes (blue ring, 1.6 s, `.task-flash`; reduced motion →
outline) and the (i) sheet opens 450 ms later; if filters hide it, the sheet opens directly; if the task isn't on the
user's list a toast says so. `task` / `completed` / `edit` are stripped from the URL afterwards (other params kept).

### Badges and Requests caption
`TopIcons` `Count` takes a tone: inbox red, bell blue (`data-badge`). `/admin/requests` and HR's leave inbox start with
"Waiting for your decision — approve, decline or act. Updates that need nothing from you are in **Notifications**."

### Call / WhatsApp / Email on the card (`contacts.ts`, `ContactSheet.tsx`, `contact-privacy.ts`)
- The card's Calendar icon is replaced by **Call** (lucide Phone), **WhatsApp** (the top bar's outline glyph) and **Email**
  (lucide Mail): seven icons, **30px** wide (26px when a voice-note mic makes eight) and a 4px gap before the time pill, so
  "10:00am – 12:00pm" still fits at 390px without touching the icons. Calendar stays in the (i) sheet.
- **Who** (one list for all three buttons, `contactTargets`; the viewer is never listed):
  - **Admin** → the client (its contact person when the contact field is a name), the task's Team Leader (the team's
    leader, else an assignee's TL, else an assignee who is one) and **one row per executive** assigned to the task;
  - **Team Leader** → the Admin (the creating Admin, else the first) + each executive on the task. **Never the client.**
  - **Executive** → their Team Leader (their own `teamLeaderId`, else the task's) + the Admin. Not the client.
- **Links.** Calls use the phone, else WhatsApp; WhatsApp the WhatsApp number, else the phone: `tel:+<digits>` and
  `https://wa.me/<digits>?text=Hi <first>, about “<task>”: ` (new tab). A bare 10-digit Indian mobile gets 91.
  **Email** → `mailto:<email>?subject=…&body=…` (encodeURIComponent; `mailtoHref` / `mailBody`):
  subject = the task title, for staff "[<Client>] <title>"; body = "Hi <first name>," (a client without a contact person:
  "Hi <Client> team,"; an honorific stays with the name: "Hi Mr Rao,") + blank line + "Regarding “<title>”" (+ " (<Client>)"
  for staff) + " — scheduled 08 Oct, 10:00am–12:00pm." (company time zone; left out when unscheduled) + blank lines +
  "Thanks,\n<viewer name>\n<company name>" (`CompanySettings.companyName`). The client's address is its email, else the
  contact field when that is an email; staff use their workspace email.
- A row without a number / email is greyed "no number saved" / "no email saved"; for Admin it carries **Add number** /
  **Add email** → `/admin/clients?edit=<id>` or `/admin/people?role=<TEAM_LEADER|EXECUTIVE>&edit=<id>` (both pages open
  that form from `?edit=`). Nobody to contact → "Nobody to contact for this task".
- `User.phone` (E.164): people form field **Mobile / WhatsApp** for every role, executives included ("Used by the Call and
  WhatsApp buttons on task cards"), at least 10 digits, normalised like client WhatsApp; "" clears, leaving it out keeps
  it. The people list shows the number or "no number".

### Privacy: contact details are filtered on the server
- `dashboardData` sends contact details only for the people on the viewer's sheets (`allowedContactIds` = the union of
  `contactTargets` over the viewer's visible tasks — the same function the sheet uses, so UI and payload agree):
  - **Admin**: every client's `emails` / `contact` / `phone` / `whatsapp` and every staff member's `phone` + `email`;
  - **Team Leader**: `phone` + `email` of the Admin(s) and the executives on the tasks they see;
  - **Executive**: `phone` + `email` of their Team Leader and the Admin.
  Everyone else in `people` keeps only id / name / role / team (needed by filters and forms), without `phone` / `email` keys.
- Team Leader / Executive `clients` rows are `{ id, name, guestCount }` — **no client email, contact or number at all**.
- Meetings: a non-Admin task row lists only guests that are not the task client's own addresses and counts those in
  `clientGuestCount` (the (i) sheet shows "<Client> (client)"). Picking the client on a Team Leader's / Executive's meeting
  sets `inviteClient` (Guests sheet chip "<Client> (client)"); `createTask` adds the client's addresses on the server
  (`taskInputSchema.inviteClient`). Admin's form keeps the visible, removable address chips. Editing is Admin-only, so the
  hidden addresses cannot be lost by a non-Admin edit.
- Tests: `tests/ui/contacts.test.ts` (who per role, links, mailto encoding, greeting fallback) and
  `tests/tasks/contact-privacy.test.ts` (payload per role against Postgres, no client detail in the TL / Exec JSON, the
  server-side client invite).

### Data
Migration `20261010240000_notification_feed`: enum values above; `Notification.invoiceId`, index `(userId, createdAt)`;
`Task.notStartedNotifiedAt`, `Task.pastEndNotifiedAt` (+ back-fill); `User.phone`.

### Demo
`prisma/seed-notifications.ts`: phones for demo users (Dev has none), client contacts (Pharma Bag Co none, Sunrise
WhatsApp only), twelve feed rows (one per colour) for Admin, Rishi (TL), Neha and Arush tied to demo tasks; demo tasks
whose times already passed are stamped so the live job doesn't repeat them; orphaned demo rows are cleaned.

## Consequences
- The bell no longer nags about bills or approvals; the inbox's red count is the to-do list. Push / email reminders for
  them are unchanged.
- Old rows keep their old long titles (shown as the headline under the task title); no data migration of texts.
- Colleagues' numbers / emails reach only the people who may contact them; client contact details reach Admins only.
- A Team Leader / Executive cannot see which client addresses a meeting invites (only "<Client> (client)").
- Open: rescheduling a task does not re-arm "Not started" / "Still not finished".
