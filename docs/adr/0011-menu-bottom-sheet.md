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
