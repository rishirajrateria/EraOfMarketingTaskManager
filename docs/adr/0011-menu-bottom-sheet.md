# ADR 0011 — Admin menu as a thumb-first bottom sheet

Status: Accepted (2026-10-10)

## Context
The Admin menu was a left drawer of plain text links copied from the original Canva frame ("expense", "PAYMENT Creator", …) with a small "+" for Add Client and a large "+" for Add Task. The owner asked for a complete redesign. Everything else in the app keeps actions in the bottom thumb zone.

## Decision
- `MenuTray` is a bottom sheet (max 92dvh, 28px top radius, frosted `--sheet` surface), portalled to `<body>`.
- Header: initials avatar, name, "Admin · <company>", Settings and Close buttons. A search box filters rows by label, status line and section.
- Sections, each a glass card of rows (34px tinted icon, label, one-line live status, optional badge, chevron):
  - Money: Invoices, Payments, Expenses, Finance sheet, Monthly Drive folders.
  - Clients: Clients, Asset drive links, Credentials, Shared drive links.
  - Team: Attendance, Inventory, Executives, Team leaders, Teams, Work types.
  - Account: Requests, Notifications, Settings, Sign out.
- Quick actions pinned at the bottom: New task, New invoice, Add expense, Add client.
- Live numbers come from the admin-only server action `menuCounts()` (`src/server/shell/menu.ts`), read each time the menu opens: invoices awaiting approval, outstanding balance, bills overdue / due within 7 days, GST to claim this month, client, credential, executive and work-type counts, team names, open requests, unread notifications.
- Labels renamed to plain words: "PAYMENT Creator" → Invoices, "expense" → Expenses, "Add executive" → Executives, "Add teamleader" → Team leaders, "Add Work" → Work types, "Add Team" → Teams.
- Only `AppFrame` renders the menu. The dashboard top bar used to render a second copy, which stacked two overlays and blocked taps on the lower one.

## Consequences
Every Admin destination is one tap from the bottom sheet, with its status visible before opening it. The counts cost one query batch per menu open.

## v3 tiles (2026-10-10)
Supersedes the row layout above (and ADR 0016's "Dashboards" section) to match the approved prototype (`.mgrid` / `.mtile`).
- Rows became square icon tiles: 4 per row (3 at ≤360px), 104px tall glass card, 44px rounded icon square in the category gradient, 12px semibold label (up to 2 lines, centred), count badge top-right with a 2px ring. The old one-line status is now the tile's `title` / `aria-label` and is still matched by the search box (label + status + section). Keyboard focus shows a blue ring.
- Colour = category, with an 8px dot before each small uppercase section header:
  - Money (green): Finance (→ Finance dashboard, red badge = approvals + overdue bills), Drive folders.
  - Clients (blue): Clients, Client kit (amber badge = active clients without a kit), Shared links.
  - Team (yellow, dark icon ink): HR (→ HR dashboard), Tasks (→ Task dashboard, amber badge = late to start), Executives, Team leaders, Teams, Work types.
  - Other (purple): Requests (red), Notifications (blue), Settings, Sign out (red icon + label).
- Tile badges are solid so they read on yellow: amber = #ea580c with white text; red stays red.
- Quick actions: New invoice, Add expense, Approvals. "New task" was dropped; adding people, teams, work types and clients lives in the dashboard "+" speed-dial, which links to `?add=1` on `/admin/work-types`, `/admin/people?role=EXECUTIVE|TEAM_LEADER`, `/admin/teams` and `/admin/clients` — each opens its add / invite form on load.
- The menu data (`menuSections`, `filterSections`, `QUICK_ACTIONS`) lives in `src/components/shell/menu-model.ts`; `MenuTray.tsx` only renders it.
