# ADR 0013 — Invoice file names, proformas keep no record, finance folders in the owner's Drive + Share, Payments & finance hub

- Status: Accepted
- Date: 2026-10-10
- Extends: ADR 0005 (invoicing v2), ADR 0009 (monthly Drive folders, cancel), ADR 0011 (menu)

## Context

The owner (marketing agency, India) asked for four things: PDF names their accountant recognises at a glance; a proforma
that is "just for the sake of giving" (no record, no cancel); the monthly finance folders in *their* Google Drive with a
Drive-style Share button; and one menu destination for everything about money instead of "Payments" and "Finance sheet",
which they found almost the same.

## Decisions

### 1. One file-name helper (`src/server/finance/file-names.ts`, pure, unit-tested)
- Tax invoice `Invoice No. <number> (<Client>).pdf`; export invoice (docType EXPORT_INVOICE or tax mode EXPORT_LUT)
  `Ex Invoice No. <number> (<Client>).pdf`; proforma `P Invoice (<Client>).pdf`; cancelled
  `C Invoice No. <number> (<Client>).pdf`; an unapproved preview `Draft Invoice (<Client>).pdf`.
- `<Client>` is the client's business (legal) name when set, else the client name. Characters illegal in file names
  (`/ \ : * ? " < > |`, control characters) are replaced (`/` and `\` → `-`, so `EOM/26-27/0001` → `EOM-26-27-0001`) or
  dropped; whitespace is collapsed; spaces and the `(…)` format stay. The client part is capped at 80 characters.
- Used by every invoice PDF: Drive uploads (client folder, Finance/Invoices, Finance/YYYY-MM/Sales invoices and
  Cancelled invoices), approval / reminder / cancellation email attachments, `GET /api/files/invoice/[id]` (download)
  and `GET /api/public/invoice/[token]` (the WhatsApp media link). Headers use `contentDisposition()` (ASCII `filename` +
  UTF-8 `filename*`, RFC 6266); Gmail attachment names are RFC 2047-encoded when not ASCII (`mimeFileName`).
- Credit notes and receipts keep their names (`EOM-CN_26-27_0001.pdf`, `<receipt no>.pdf`). The GST pack ZIP holds only
  vendor bills, so it is unchanged.
- Cancelling: the Sales invoices copy is moved to Cancelled invoices, renamed to the `C Invoice` name and its content
  replaced by the stamped PDF in one `files.update` (`updateFile` in `src/google/drive.ts`); if it no longer exists the
  stamped PDF is uploaded under that name. The client-folder and Finance/Invoices copies are renamed and re-stamped too.

### 2. A proforma is not a record
- It can be created, approved, sent (email / WhatsApp), downloaded and converted into a tax invoice as before.
- It can't be cancelled: the Cancel action is never offered for proformas and `cancelInvoice` rejects with
  "A proforma can't be cancelled. It is only an estimate and no record is kept of it, so there is nothing to cancel." —
  checked before the form is validated. Because nothing is kept, an unconverted proforma can be **deleted at any time**
  (a converted one stays linked to its tax invoice). The invoice page shows a "Proforma · for reference only" note.
- Not filed: never into the monthly folders (already true) and no longer into `Finance/Invoices` (fixed: approval used to
  upload it there); only the client-folder copy is kept.
- Not counted: sales / outstanding / finance totals, client ledger, overdue job, month-folder counts already used
  TAX + EXPORT only. Fixed: the Finance Google Sheet's Invoices tab no longer lists proformas, and the "Awaiting
  approval" ₹ tile excludes proformas (they still count as items waiting for approval).
- Numbering: proformas use their own reference series (`EOM-PRO/…`) and never take a tax-invoice number (already true);
  the file name carries no number.

### 3. Finance folders in the owner's My Drive + Share
- Verified: every Drive call uses the service account with domain-wide delegation impersonating
  `GOOGLE_IMPERSONATE_USER`, so a folder created without a parent goes to that user's **My Drive**. Two gaps were fixed:
  the parentless folder lookup searched every folder visible to the user (it could pick a same-named folder someone
  shared with them) — it is now limited to `'root' in parents`; and with no impersonated user (and no
  `GOOGLE_DRIVE_ROOT_FOLDER_ID`) the folders would land in the service account's own drive, so `ensureFinanceRoot`
  now refuses in live mode with a clear message (the page shows "Drive unavailable").
- The Finance root id is cached in `FinanceDriveRoot` (migration `20261010190000_finance_drive_root`, one row,
  `ownerEmail`); month folders are created under it. If the impersonated user changes, the root is resolved again.
- `/admin/drive-folders` subtitle: "Saved in <owner email>'s Google Drive · FY 26-27" (GOOGLE_MOCK: the first Admin
  stands in for the owner).
- Share sheet (`DriveShareSheet`, like Google Drive's dialog): Add people (email chips with validation, Viewer /
  Commenter / Editor, Notify people with an optional message, Send), People with access (owner fixed; others change role
  or Remove access), General access (Restricted / Anyone with the link + role), Copy link (clipboard, falls back to
  selecting the link). Available on the Finance root card and on every month card.
- `src/google/drive-share.ts`: Drive v3 `permissions.list/create/update/delete` (`supportsAllDrives`,
  `sendNotificationEmail` + `emailMessage`, `type: anyone` for link sharing, `allowFileDiscovery: false`). GOOGLE_MOCK
  keeps permissions in memory (on `globalThis`) so the demo and tests work.
- `src/server/finance/drive-share.ts` actions (`getFolderSharing`, `shareFolder`, `changeShareRole`,
  `removeShareAccess`, `setGeneralAccess`): Admin only, zod-validated, and the folder id from the browser must match
  `FinanceDriveRoot.folderId` or a `FinanceMonthFolder.folderId` — anything else gets "Only the Finance folders created by
  this app can be shared from here". The owner's permission can't be changed. Each change writes an audit row
  (`drive.share.add|role|remove|link`, entity `DriveFolder`).
- Month cards were tightened: one header row (month · Share · Open in Drive), a 2×2 grid of count chips (Sales
  invoices, Expense bills, GST claimable, Cancelled — each opens its subfolder) and one line with GST to claim + "GST
  pack ›".

### 4. Menu: one "Payments & finance" destination
- The Money section is Invoices · **Payments & finance** · Expenses · Monthly Drive folders. The row's status line says
  what needs attention ("2 to approve · 1 overdue · ₹4,22,400 outstanding"; otherwise "Nothing pending · …"); an amber
  badge counts client invoices overdue (`menuCounts().invoicesOverdue`). Invoices keeps its own row and approval badge.
- `/admin/payments` is the hub: tiles; **Needs you** (Approve & send → opens the invoice with the approve sheet via
  `?approve=1`; client payments overdue with a one-tap **Remind**; bills overdue or due in 7 days with **Pay** →
  `/admin/expenses?tab=DUE&pay=<id>` opens Mark paid); the **finance summary** that was the Finance sheet (totals,
  payables tiles, 12-month chart, per client, TDS with This FY / Previous FY, per month); then the payments lists. The
  bottom zone keeps month and method filters and gains the Finance sheet row (Export CSV, Push to Sheet, Open sheet).
- `/admin/finance` redirects to `/admin/payments` (keeping `?fy=previous`).

## Consequences
- Drive file names change for new filings only; files already in Drive keep their old names.
- Approving a proforma uploads one file (client folder) instead of two.
- A live deployment without `GOOGLE_IMPERSONATE_USER` (and without a configured root folder) no longer creates finance
  folders at all, instead of hiding them in the service account's drive.
- Sharing needs the Drive scope already granted to the service account; adding non-Google addresses may require
  "Notify people" (Drive's own rule) and is reported per address.
