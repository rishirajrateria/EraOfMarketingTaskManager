# ADR 0009 — Payables (bills with payments), GST credit pack, monthly Drive folders, cancelling a sent invoice

- Status: Accepted
- Date: 2026-10-10
- Extends: ADR 0004 (fixed expense categories), ADR 0005 (invoicing v2), ADR 0006 (TDS), ADR 0007 (PDF template)
- Reference: the owner's prototype `docs/prototype/eom-tasks.html` (`expenseTick`, `PAGES.expenses`, `occSheet`,
  `markPaid`, `gstBlock`, `billDetailsSheet`, `sendPackSheet`, `billEditor`, `recurPicker` / `recurText` / `nextDate`,
  `PAGES.drive`, `cancelSheet`, `openInvoice`, `invoicePreview`, `PAGES.finance`)

## Context

Expenses were a flat log of money already spent. The owner wants to see what is **due**: rent every month, salaries on
the last day, a vendor paid in parts, with reminders before the date; record how each payment was made, with TDS; keep
the vendor's GST bill and hand the claimable ones to the finance person every month; and file everything in Drive by
month. Separately, a sent invoice sometimes has to be withdrawn (wrong amount) without breaking the number series.

## Decisions

### Data model (migration `20261010160000_payables_gst_month_folders_cancel`)
- `Expense` is now the **bill**: `kind` REGULAR | SALARY (+ `salaryUserId`; payee = the member's name), `timing`
  PREPAID | POSTPAID | ADVANCE, `plan` ONE_TIME | RECURRING | PART (reuses `BillingPlan`), `repeatRule Json?`,
  `remindDays Int @default(1)`, `vendorGstin`. `vendor` holds the payee; `amount` is the bill (one-time), each payment
  (recurring) or the total (parts); `date` is the first due date.
- `ExpenseOccurrence` is one **payment due**: `seq`, `label` ("Part 1 of 2 · Advance", "Balance of …"), `amount`,
  `dueDate` (start of the due day in the company timezone), `status` DUE | PAID, `paidAt` (noon of the paid day),
  `method` CASH | UPI | BANK | CARD | CHEQUE (`ExpenseMethod`), `reference`, `tdsPercent` / `tdsAmount`, `gstAmount`,
  `gstRate`, `vendorGstin`, `itcClaimable`, the bill file (`billData` / `billMime` / `billName`), Drive ids
  (`billDriveId` → Expense bills, `itcDriveId` → GST claimable) and `notifiedAt` (reminder sent).
- The repeat rule is a JSON column validated by `repeatRuleSchema` (src/server/finance/schemas.ts): `freq` DAILY |
  WEEKDAYS | WEEKLY | MONTHLY | YEARLY, `interval`, `weekdays` (0 = Sun), `monthMode` DATE | NTH, `monthDay` (32 = last
  day), `nth` (1–5, 5 = last), `nthWeekday`, `yearMonth` (1–12), `yearDay`, `endsType` NEVER | COUNT | UNTIL,
  `endsCount`, `endsUntil`, `anchorDate` (all dates `yyyy-MM-dd`). It is the shape the task repeat picker will reuse.
- **Data migration**: every existing expense gets one PAID occurrence carrying its amount, date, TDS (when
  `tdsApplied`) and receipt (bytes, mime, Drive id), so old rows still appear under Paid and in the FY TDS totals.
  The legacy money / TDS / receipt columns on `Expense` stay (no data loss) but are no longer written; the voice note
  route keeps serving old voice notes.
- `FinanceMonthFolder` (month unique, folder + four subfolder ids); `Invoice.cancelReason`, `Invoice.monthDriveFileId`
  (the copy in the month folder); `CompanySettings.financeEmail`; notification kind `PAYMENT_DUE`.

### Repeat rules (`src/server/finance/repeat.ts`, pure and client-safe)
- `nextDateKey(rule, afterKey, doneCount)` / `nextDate(rule, after, doneCount, tz)` match the prototype on calendar
  days (no DST / offset drift): weekly intervals are counted in Monday-based weeks from the anchor week; monthly dates are
  clamped to the month (32 = last day, 29 Feb → 28 Feb in yearly rules); the nth weekday supports "last"; COUNT stops
  once `doneCount` payments exist ("Balance of …" rows are not counted); UNTIL includes the until day.
- `describeRule` gives the prototype's text: "Every Thu, Fri · 10 times", "Every month on the last day",
  "Every weekday (Mon–Fri)", "Every 2 weeks on Mon, Sun", "Every year on 5 Mar", "Every day · until 05 Dec".

### Server (`payables.ts` actions → `payables-core.ts`, `payables-pay.ts`, `bill-files.ts`; ADMIN only via `requireFinanceActor`)
- `createBill` / `updateBill`: categories must be in the Settings list. ONE_TIME (optionally "already paid": stamped on
  the due day when that is today or earlier, else now), RECURRING (first due + rule), PART (fixed ₹ parts must add up to
  the total ±₹0.50, % parts to 100; the last % part takes the rounding). Before any payment an update rebuilds the
  schedule; once something is PAID the schedule is frozen and a new amount updates the recurring bill's DUE payments.
- `markPaid(occurrenceId, input, files?)`: paying less leaves a "Balance of …" DUE occurrence with the same due date;
  a recurring bill with nothing else due gets its next occurrence; the message reads "Part paid · balance ₹… still due",
  "Marked paid · next ₹… on dd Mon", "· next: Part 2 of 2 … " / "· all parts paid". TDS ≤ payment; GST ≤ payment;
  auto GST = amount × rate / (100 + rate). The vendor GSTIN is remembered on the bill.
- `undoPaid` (back to To pay; GST + file kept, Drive copies trashed), `moveDueDate` (reminder re-armed), `skipOccurrence`
  (recurring only; creates the next when nothing else is due), `billDetails` / `attachBill` (≤ 12 MB, image or PDF,
  checked with `safeMime`), `deleteBill`, `addExpenseCategory` (inline "+ New": appended before a trailing "Other",
  case-insensitive dedupe).
- **TDS (ADR 0006 revised)**: the payee threshold, `vendorTdsSummary` and `tdsSummary.onExpenses` are computed from PAID
  occurrences by paid date. Salary bills are excluded from the payee threshold (their TDS still counts in the FY total).
  After a payment without TDS that takes a regular payee to / over the threshold, admins get the same `TDS_THRESHOLD`
  notification as before and the sheet shows the warning.
- Read models (`payables-queries.ts`): `listBills`, `listPaidOccurrences` (CSV + Sheets mirror, now one row per paid
  payment with TDS and GST columns), `payablesTiles` (finance sheet).

### Job (`src/jobs/payables.ts`, registry `payables`, hourly; idempotent)
- A recurring bill with nothing DUE gets its next occurrence once the last paid due date is within `remindDays` of today.
- Each DUE occurrence notifies admins once (`notifiedAt`, claimed with a conditional update) when
  `dueDate − remindDays ≤ today`: "Payment due in 3 days: Skyline Spaces ₹25,000 (Part 1 of 2) · Rent", "Payment due
  today: …", "Overdue: …".

### GST credit pack (`gst-pack.ts`)
- The month's claimable bills = PAID in that month, `itcClaimable`, `gstAmount > 0`. `GET /api/finance/gst-pack?month=`
  (ADMIN) returns `GST-pack-YYYY-MM.zip` (fflate, MIT): each attached bill as `yyyy-MM-dd-<payee>-<id>.<ext>` plus
  `summary.csv` (date, payee, vendor GSTIN, bill amount, GST rate, GST amount, file name — `MISSING` when no file — and a
  TOTAL row). `sendGstPack(month, email)` saves `financeEmail` and mails the ZIP with the summary in the body.

### Monthly Drive folders (`month-folders.ts`, job `month-folders`)
- `ensureMonthFolder(yyyy-MM)` → Drive `Finance/YYYY-MM` with "Sales invoices", "Expense bills", "GST claimable",
  "Cancelled invoices"; ids cached in `FinanceMonthFolder`; created by the daily job (so on the 1st) or lazily on first
  use. Filing is best effort and never blocks the action.
- Approving a tax / export invoice or credit note files its PDF once into Sales invoices of the approval month
  (`approve-core.ts`); paid bills go into Expense bills of the paid month and also GST claimable when claimable.
- ☰ → **Monthly Drive folders** (`/admin/drive-folders`): FY months newest first with counts (sales invoices, expense
  bills, GST claimable with ₹, cancelled invoices), Open in Drive (mock folder URLs in GOOGLE_MOCK) and "GST pack ›".

### Cancel a sent invoice (`cancel-core.ts`, `cancelInvoice`)
- Only approved TAX / EXPORT invoices that are SENT or OVERDUE with no payments and no credit notes; otherwise
  "This invoice has payments. Use a credit note to reverse it." A reason is required.
- The number stays used (the counter is untouched; `peekNextNumber` shows the next one without consuming it). The invoice
  becomes CANCELLED with `cancelledAt`, `cancelReason`, `remindAt = null`; its plan part and the plan's PENDING parts are
  cancelled (plan CANCELLED / COMPLETED when nothing is open); a work hold tied to it is released (`resumeWorkCore`).
- The PDF is re-rendered with a rotated red CANCELLED stamp and "Cancelled on … · Reason: …" (`pdf.ts`), stored, filed
  into Cancelled invoices of the issue month, and the Sales invoices copy is trashed. Optional email (with the stamped
  PDF) / WhatsApp notice to the client. Audited.
- UI: red banner on the invoice, "Cancel invoice" pill → confirm sheet (client, amount, "Number … stays used",
  "Next invoice …", reason, two notify boxes, the GST-return note, Keep it / Cancel invoice); invoice list "Cancelled" tab;
  cancelled invoices are excluded from All and from every outstanding / billed total.

### UI
- `/admin/expenses`: five tabs in the bottom zone with per-tab bar actions (Export / + Add expense; GST tab: Drive,
  Download, Send). Bill editor is a page (`/admin/expenses/new`, `/admin/expenses/[id]`). Components in
  `src/components/finance/payables/`.
- Finance sheet: expenses on a paid basis; new tiles "To pay · 30 days", "Overdue to pay", "GST to claim · <Mon>",
  "Expense bills attached".
- Settings → "TDS & GST pack": finance person's email.

### Relation to the task repeat rules (ADR 0010)
- ADR 0010 landed in parallel with `src/server/tasks/repeat-rule.ts` (prototype field names: `days`, `nthDay`, `yMonth`
  0–11, `ends` / `count` / `until`, `anchor`) and RecurrenceRule columns. The bill rule keeps the field names this ADR
  was briefed with (`weekdays`, `nthWeekday`, `yearMonth` 1–12, `endsType` / `endsCount` / `endsUntil`, `anchorDate`)
  in a JSON column; the calendar semantics are the same (both follow the prototype's `nextDate`). Converging the two
  modules onto one shape is a follow-up (a small JSON migration of `Expense.repeatRule` + reusing one picker).
- The finance screens added here use the ADR 0010 glass tokens and shared controls (`ScreenHeader`, `EmptyState`,
  `SegButton`, `Stepper`, `GroupLabel`, `text-ink` / `text-muted` / `border-hair`).

## Consequences
- `createExpense` / `updateExpense` / `deleteExpense` (FormData) and the old expense form are gone; tests and the seed use
  the bill API. `vendorFyTotal` / `tdsThresholdStatus` take an occurrence id to exclude (was an expense id).
- Expense totals everywhere (finance sheet, CSV, Sheets) are on a paid basis; a DUE bill never counts as spent.
- New dependency `fflate` for the ZIP.
