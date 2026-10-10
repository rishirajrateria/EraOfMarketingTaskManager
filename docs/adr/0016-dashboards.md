# ADR 0016 — Admin dashboards (Finance · HR · Tasks), one requests inbox, one top bar, Dashboards-first menu

- Status: Accepted
- Date: 2026-10-10
- Extends: ADR 0011 / 0014 (menu), ADR 0013 (finance hub "Needs you"), ADR 0015 (bottom filter rows, row colours)
- Supersedes: ADR 0011/0013/0014 menu rows Invoices · Payments & finance · Expenses and the Time & attendance section;
  SPEC §10 inbox URL `/requests` for Admin; the per-page app header (☰ · title · requests · bell · avatar)
- Reference: `docs/prototype/eom-tasks.html` — `PAGES.insights`, `finBody`, `hrBody`, `taskBody`, `incomeExpenseChart`,
  `barList`, `reqTab` / `reqFin`, `.dbtiles`, `.drow`, `.vchart`, `.dblinks`, `refreshTop` / `pageTop`, `appMail`, `.tsep`

## Context
The owner wants to see money, people and work at a glance without walking through six menu rows, answer everything that
waits for them in one inbox, and reach Gmail / Drive / WhatsApp from every screen.

## Decisions

### Route, URL state, access
- `/admin/dashboards?view=FIN|HR|TASK&fin=ALL|INC|EXP&team=<id>&client=<id>&period=MONTH|LAST|QUARTER|FY` (defaults FIN ·
  ALL · MONTH; unknown values fall back). `src/server/dashboards/params.ts` (pure) parses, builds canonical hrefs and
  says which filters apply: TEAMS for HR + Tasks, CLIENTS for Finance (Overview / Income) + Tasks. Filters a view doesn't
  use stay in the URL so switching views and back keeps them. Admin only (`requireAdminPage`; others are redirected).
- Only the picked view's numbers are computed. Taps go through `router.push` in a transition with an optimistic pill
  state; the old content stays, dimmed (`aria-busy`), until the new one arrives. `loading.tsx` shows tile/card
  skeletons on first load.

### WHEN (`src/server/dashboards/period.ts`, company timezone, end exclusive)
This month · Last month · 3 months (this month and the two before) · This FY (Indian FY from 1 April via `fyRange`, to
the end of this month). The caption row shows "THIS MONTH · OCT 2026" on the left and the active team / client (or
"everyone") on the right.

### Finance (`src/server/dashboards/finance.ts`)
- Reuses `paymentsDashboard` (outstanding / overdue per client), `awaitingApproval`, `financeSummary` (monthly received
  vs paid expenses for the chart) and `payablesTiles` (to pay in 30 days, bills overdue); adds period sums of payments
  (tax / export invoices only — proformas and credit notes never take payments) and of paid bill occurrences
  (paid basis, ADR 0009). Invoiced = approved tax / export invoices (`BILLED_WHERE`) approved in the period.
- Overview: Received · Spent · Net · Outstanding (+ "₹1.3L overdue") · To pay (next 30 days) · GST to claim; "Income vs
  expense" for the last 6 months; "Top clients · received" (tap = filter by that client).
  Income: Received · Invoiced · TDS cut · Outstanding · Overdue · To approve + "Received by client", "Still owed".
  Expense: Spent · To pay · Overdue bills · GST to claim · TDS deducted · Bills paid + "Spent by category", "Next bills"
  (5 next DUE occurrences → `/admin/expenses?tab=DUE&pay=<occ>` = Mark paid).
- Outstanding / overdue are "now" whatever the period.
- **Bills are not tied to clients**: with a client picked, expense figures are `null` and show "—" / "not per client",
  the chart is hidden, and the Expense sub-view has no CLIENTS row (the client filter does not apply there).
- Under the content, link pills to the lists the menu no longer carries: Overview "Invoices › Payments › Expenses ›
  Drive folders ›", Income "Invoices › Payments ›", Expense "Expenses › Drive folders ›".

### HR (`src/server/dashboards/hr.ts`)
- Team Leaders + Executives (team filter). Capacity and booked minutes come from `inventoryFor` over the period — the
  same numbers as the Inventory page (booked = open work tasks scheduled in the period).
- Tiles: Present (today, x / n; half day counts), On leave (today: LEAVE attendance or an approved leave without a row),
  Free to assign (sub "x of y h booked"). Card "Team inventory · booked of capacity": today's status pill (Present / Half
  day / On leave / Absent / Holiday / Not marked), a capacity bar (red > 90 %, amber > 70 %, else the series colour),
  "Team · x of y h booked · z h free · n days off" (absent / leave rows + approved leave days in the period). Tap → Inventory.

### Tasks (`src/server/dashboards/tasks.ts`)
- Open = live, not completed. Each is coloured with `rowColour` (the card logic): started green, late to start red,
  paused yellow, doubt purple, otherwise not started. Hours count work tasks only (meetings count as tasks).
- Completed in the period = approved (else actual end) in range; On time % = completed whose `actualTone` isn't red.
- "Open tasks by state" stacked bar in the card colours with a legend; "Open hours by team / client" (tap = filter).

### Charts (no library; `src/components/dashboards/charts.tsx`)
- Income `--s-inc` #2a78d6 / dark #3987e5, expense `--s-exp` #eb6834 / dark #d95926 (validated pair: lightness, chroma,
  CVD ΔE ≥ 24, contrast ≥ 3:1 on both surfaces), `--grid` for the recessive mid line + baseline; tokens in `globals.css`
  with prefers-color-scheme and `[data-theme=dark]` overrides.
- One axis (₹ max · half · 0, a nice 1 / 2 / 2.5 / 5 × 10ⁿ maximum). Bars 4px rounded tops on the baseline, 2px between
  the pair, legend always shown. Hover (mouse) or tap a month → tooltip (month, income, expense, net); Escape / tapping
  elsewhere closes. Text wears text colours; only marks carry series colour. Each chart has aria-labels and a
  visually-hidden table. Bar lists: one colour, value as text, rows are buttons when tapping filters.

### Bottom zone
The same neutral glass one-tap rows as the task dashboard — `FilterRow` / `DockPill` were moved to
`src/components/ui/FilterRow.tsx` and reused (a `dense` 38px variant; rows without "All" are single choice; the picked
pill is scrolled into view). Rows: VIEW · SHOW (Finance) · TEAMS (HR, Tasks) · CLIENTS (Finance, Tasks) · WHEN. Then
three actions: Finance Requests (red badge = finance items needing you) · + Invoice · **+ Expense**; HR Requests (open
leave) · Inventory · **Attendance**; Tasks Requests (open work requests) · Task list · **+ Task** (`/dashboard?add=WORK`).

### One requests inbox (`/admin/requests`)
- `/requests` redirects Admin there (keeping `tab` / `all`), HR to `/requests/leave`, others to `/dashboard`.
- Tabs (bottom row) All · Finance n · Work n · HR n (`?tab=`). Finance = the hub's "Needs you" queries
  (`financeNeeds`): invoices awaiting approval (→ approve sheet), client invoices overdue ("3 days late" → invoice) and
  bills overdue or due within 7 days (→ Mark paid; red only when overdue). On the Finance tab a second row narrows it:
  All · Approvals n · Payments n · Expenses n (`?fin=APPR|PAY|EXP`); the tab count is their sum. Work = finish, doubt,
  review (incl. per-pill review, ADR 0015), time change, fix self task; HR = leave requests (addressed to HR, Admin can
  approve) and changes to approved leave (`requestArea`, pure). "Show handled requests" lists resolved ones.
- Bottom actions: Task list · Dashboards (the view that matches the tab). Request actions are unchanged.

### One top bar on every screen (`src/components/shell/TopBar.tsx`, `TopIcons.tsx`)
- ☰ (Admin) | Gmail · Drive · WhatsApp (every role; `<a target=_blank rel=noopener>`; Gmail / Drive carry
  `?authuser=<signed-in email>`, WhatsApp `https://wa.me/`) | divider | Dashboards (Admin) · Requests (Admin; HR → leave
  inbox) · Notifications · avatar. 34px buttons, 18px icons, 2px gaps — fits 360px. Badges follow live events.
- The task dashboard draws it inside its cyan summary. Every other page (AppFrame) gets it in a cyan band with 18px
  rounded bottom corners at the very top, then the page's row: back arrow (history back, else home) + title. The header's
  separate ☰ is gone. The add-task full-screen sheet keeps its own header.

### Menu (ADR 0011 / 0014 revised)
- Sections: **Dashboards** (Finance dashboard — "1 to approve · ₹4.2L outstanding", red badge = approvals + overdue
  bills; HR dashboard — "3 present · 1 on leave today" when today is marked, else "Attendance, inventory, leave"; Task
  dashboard — "11 open · 1 late to start", amber badge = late; Monthly Drive folders) · Clients · Team · Account
  (Requests → `/admin/requests`, Notifications, Settings, Sign out). Invoices, Payments & finance, Expenses and the Time
  & attendance section are removed from the menu; the routes stay and are reached from the dashboards.
- Quick actions: New invoice · Add expense · Approvals (`/admin/requests?tab=FIN&fin=APPR`) · New task.
- `menuCounts()` adds `attendanceMarkedToday`, `presentToday`, `onLeaveToday`, `tasksOpen`, `tasksLate`.
- Superseded in layout by ADR 0011 "v3 tiles": the dashboards are now the Finance (Money), HR and Tasks (Team) tiles, the
  sections are Money · Clients · Team · Other, and the quick actions drop New task.

## Consequences
- No schema change. The dashboards read existing data only.
- Notifications that link to `/requests` keep working through the redirect.
- Expense numbers are company-wide; a per-client cost view would need bills tagged with clients (not planned).
- HR "booked" counts open work tasks (as the Inventory page does), so a past period shows little booked time.

## Addendum (2026-10-10) — one "+" speed dial on the task dashboard bar
Reference: prototype `fabItems`, `openFab`, `.fabdim`, `.fabi`, `kitPicker`.
- The bar's Google Meet button and blue + merge into one blue + (`AddSpeedDial`, `aria-haspopup="menu"`,
  `aria-expanded`). Tapping it rotates the + 45° into × and opens a `role="menu"` stack growing upward, right-aligned:
  each row = glass-strong label chip + 44px gradient square (Task / Meeting 50px). Bottom → top: **Task** (add-task
  sheet, WORK) · **Meeting** (add-task sheet, MEETING) · separator · Admin only: Invoice (`/admin/invoices?new=1`) ·
  Expense (`/admin/expenses/new`) · Executive / Team leader (`/admin/people?role=…&add=1`) · Work type · Team
  (`?add=1`) · Client kit. Team Leaders and Executives see Task and Meeting only. Colours follow the menu tiles.
- The model is pure data (`src/components/dashboard/fab-model.ts`, tested): order, role filter, links.
- Backdrop = dim + 3px blur over everything above the 56px bar (portalled, centred like `.phone-frame`), so the ×
  stays tappable. Closes on ×, backdrop, a tap elsewhere on the bar, Escape (focus back to +) and after choosing.
  Focus lands on Task; ↑/↓/Home/End walk the stack. Items fade/rise 8px with an 18ms stagger; none with
  `prefers-reduced-motion`.
- Client kit opens "New client kit": active clients from `kitPickerClients()` (Admin only), clients without a complete
  kit first ("Create the kit" / "Kit incomplete · repair it" / "Kit ready · open it"), then "+ New client"
  (`/admin/clients?add=1`). Picking a client opens `/admin/client-kit/<id>`, whose Create kit / Repair / share / send
  buttons (ADR 0014) do the rest — no second create path.

### Bottom nav rows and the "+ → ×" convention (prototype `#dashNav`, `renderAddNav`, `cancelX`)
(The nav row is on every screen and the + itself is the × now — see the next section.)
- Dashboard bottom: the time pills (📅 · Today · Tomorrow · Oldest) get their own full-width row; below it a 64px glass
  nav row: Dashboard (`/admin/dashboards`) · Requests (`/admin/requests`, red count) · Notifications (`/notifications`,
  count) · Profile (`/me`, blue-gradient initials) sharing the width, then the 52px blue + (speed dial; its backdrop
  stops above this row). Team Leaders / Executives see Notifications and Profile only. On the dashboard only the top
  bar shows just Gmail · Drive · WhatsApp (`TopBar appsOnly`); every other page keeps the full top bar.
- Add-task bottom: the time pills row (📅 · Up next · Today · Tomorrow), then the 64px nav row: 44px Task / Meeting
  type toggles (selected = 2px blue ring, `aria-pressed`; they replace the old Meet / Work buttons), Admin only a
  scrolling strip of the speed dial's other items (Invoice · Expense · Exec · Work · Team · Leader · Kit, right-edge
  fade) — tapping one closes the sheet and runs the item (`useFabRunner`) — and the 52px blue × in the + 's exact spot.
- Sheet forms (superseded below by the one corner close control): one shared `CloseX` / `SheetButtons` (`src/components/ui/CloseX.tsx`): a plain "Cancel" that only closes
  becomes the 52px blue rounded-16 × placed last, the primary action filling the rest (`[Save ————] [×]`); such sheets
  pass `hideClose` so the title row has no second ✕. Applied to `FormFooter` (people, teams, work types, clients), the
  kit picker, Which day?, note / assign / edit-task sheets, leave, attendance, inventory range, requests note, the
  payables sheets (incl. new expense category) and both repeat pickers. Destructive confirmations (Delete task, Delete bill, Keep / Not now) and
  the Drive share invite's in-place cancel keep their buttons.
- Everything the + opens closes with that × and returns to the dashboard (prototype `pageX`). Speed-dial / strip links
  carry `from=add` (`/admin/invoices?new=1&from=add`, `/admin/expenses/new?from=add`, `/admin/people?…&add=1&from=add`,
  `/admin/work-types|teams?add=1&from=add`, and the kit picker's `/admin/clients?add=1&from=add`); `useFromAdd()` then
  sends ×, Escape, backdrop and a successful save back to `/dashboard` (`router.replace`). Opened any other way the
  screens behave as before. New invoice wizard: `[Next ———][×]` on step 1, `[Back][Next ———][×]` after (the header ✕
  is gone; a saved invoice still opens its detail page); new expense: `[Save ———][×]` (editing keeps Delete · Save);
  `BottomZone actions` renders such a button row in place of the green / glass bar.

### Bottom nav on every screen, one close control, the "+" list flow (2026-10-10, later the same day)
Reference: prototype `#gNav`, `.hasnav`, `navActive`, `renderDashNav`, `afterShow`, `.fabeye`, `openListFlow`,
`renderPeek`, `.peekbtn`, `cornerMode` / `syncCorner` / `cornerTap`, `pageX`, `.hasnav .dim`, `.dview`. Supersedes the
parts of the two sections above that put the nav row on the dashboard only, kept the full top bar elsewhere and drew
a separate × in every form.
- **Bottom nav everywhere.** `GlobalNav` (`src/components/shell/GlobalNav.tsx`) is rendered once by `AppFrame` for
  every signed-in screen, the task dashboard included: fixed 64px glass + safe-area inset, centred like
  `.phone-frame`. `.has-gnav` on the frame sets `--gnav-h` (64px + inset) and pads the frame by it; every sticky
  bottom zone (`BottomZone`, notifications, requests, dashboards) uses `.zone-sticky` (`bottom: var(--gnav-h)`) so it
  sits on the nav, never behind it; the dashboard is `100dvh − --gnav-h` tall. Not on login, and covered by the
  add-task screen (its own row). The top bar of every page is now ☰ (Admin) + Gmail · Drive · WhatsApp only.
- **Tabs toggle** (`nav-model.ts`, tested): Admin Dashboard (`/admin/dashboards`) · Requests (`/admin/requests`, red
  count) · Notifications (count) · Profile; HR keeps the Requests tab its top bar had (`/requests/leave`); Team
  Leaders, Executives (and parked CA) Notifications · Profile. The tab whose path (or sub-path) is open is highlighted
  (`--nav-on` blue icon + label on a `--nav-on-bg` square, ring on the avatar, `aria-current="page"`); tapping it
  again goes home (`/dashboard`; HR `/attendance`), tapping another opens that one. Plain links, so history works.
- **The + on every page.** Same speed dial; Task / Meeting open the dashboard's add-task sheet in place when the
  dashboard is mounted (`add-task-store`), elsewhere `/dashboard?add=WORK|MEETING` (the sheet drops `?add` on close).
  HR / CA have no +.
- **Eye = view** (`fab-model` `view`, `list-flow.ts`, tested): Executive, Work type, Team, Team leader and Client kit
  get a 38px glass eye left of the label (`View executives` / `View work types` / `View teams` / `View team leaders`
  / `View client kits`; ← / → move between eye and item, ↑ / ↓ keep the column). Eye → the list page with the add
  form minimised (`?add=min&from=add`): a 46px bar just above the nav — blue + square, "Add executive" / "Add work
  type" / "Add team" / "Add team leader" / "New client kit", chevron — that expands it; the page's own "+ Add" is
  hidden while in the flow (People keeps its role pills). The item itself → the same page expanded (`?add=1&from=add`)
  instead of over the dashboard. In the flow (`useAddForm`): Escape / tap outside minimise (the draft is kept: the
  sheet stays mounted, `hidden`), the corner × returns to `/dashboard`, a save returns to the list minimised with a
  blank form. Expand / minimise are `history.replaceState(null, …)` (synced with `useSearchParams`, no round trip);
  after a save `router.replace` (it supersedes the admin action's `router.refresh`, which would restore the old URL).
  A plain `?add=1` (menu deep links) keeps its old meaning. Client kit's add form is the "New client kit" picker.
- **One close control** (`corner-store.ts`, tested): the bottom-right button is the only ×. Every open `Sheet`
  registers its close (`onCornerClose`, default `onClose`), and so do closable form pages (`useClosablePage`: the new
  expense editor — back, or `/dashboard` when `from=add`); while anything is registered the + shows × (rotated 45°,
  `aria-label="Close"`) and a tap closes the most recent one, else it opens the speed dial. Sheets and their dim stop
  above the 64px row (+ inset) so the corner stays visible; full-height sheets (new invoice wizard, edit draft,
  approve, edit task) too. Only the add-task screen (`Sheet cover`) covers the row; its own row's × closes an open
  sheet first (`cornerStore.closeTop()`), then the screen, and its sheets also stop above that row. HR / CA get the ×
  only while something is open. Tapping a tab while a sheet is open leaves the page, sheet and all.
- Forms no longer draw a ×: `SheetButtons` is just the action row (`[Save ————]`, `[Back][Next ————]`), `FormFooter`
  `[extra][Save ————]`, the kit picker has no button row, sheets have no title ✕ (`hideClose` is gone). Escape and a
  tap outside still close (minimise in the list flow). Destructive confirmations keep Keep / Delete.
- **Dashboards** (`/admin/dashboards`): the action row ([Requests][+ Invoice][+ Expense] / [Requests][Inventory]
  [Attendance] / [Requests][Task list][+ Task]) is gone — the nav and its + cover it; the menu's Team group gains
  Attendance (`/attendance`, user-check) and Inventory (`/admin/inventory`, clock) right after Tasks. The pill rows
  read top → bottom Show (Finance) · Teams · Clients · When · View — View lowest, nearest the thumb.
- **Requests** (`/admin/requests`): same rule — a screen's primary pill row sits lowest, just above the nav. The
  Finance sub-row (All · Approvals · Payments · Expenses) sits above the inbox tabs (All · Finance · Work · HR, with
  counts), and the Task list / Dashboards buttons are gone (the nav covers both).
