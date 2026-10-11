# ADR 0005 — Invoicing v2 (client-first finance)

Status: accepted · Date: 2026-10-09

Decisions confirmed with the client: invoices are never auto-sent (Admin approves each one in a confirm sheet with
Email + WhatsApp ticked; WhatsApp via **Twilio**); document type and GST are **derived from GSTIN state codes**
(same state → Tax Invoice CGST+SGST; other Indian state → IGST; client outside India → Export Invoice, **0% under LUT,
INR**); **part payments** have one due date, amount (% or fixed) and optional description per part, and the
remaining parts can later be merged into one; **recurring** invoices can bill on the 1st or last day of the month;
**push forward** sets a reminder date; **Hold work** pauses all the client's open tasks and notifies; payments record
**CASH / BANK / UPI** and **TDS**; corrections use **credit notes**; a **proforma** can be converted into the tax
invoice; the PDF carries a **UPI QR** and bank details; a **Payments dashboard** shows outstanding by client and what is
due soon.

## Data model (prisma/schema.prisma, migration `20261009120000_invoicing_v2`)

- `Client`: `country` (ISO-2, default IN), `stateCode`/`stateName` (derived from GSTIN, editable), `phone`,
  `whatsapp` (E.164), `tdsPercent`, `workOnHold`, `holdInvoiceId`, `holdSince`, `plans`.
- `Invoice`: `docType` (TAX_INVOICE | EXPORT_INVOICE | PROFORMA | CREDIT_NOTE), `taxMode` (CGST_SGST | IGST |
  EXPORT_LUT | NONE), `placeOfSupply`, `cgstAmount`/`sgstAmount`/`igstAmount`, `plan` (ONE_TIME | RECURRING | PART),
  `planId`/`partSeq`, `description`, `approvedAt`/`approvedById`, `remindAt`, `emailSentAt`, `whatsappSentAt`,
  `whatsappStatus`, `publicToken`, `proformaOfId`/`convertedTo`, `creditNoteOfId`/`creditNotes`, `cancelledAt`.
  `number` is `DRAFT-<id>` until approval; the FY series number is allocated **at approval**.
  Status: DRAFT → AWAITING_APPROVAL → SENT → PARTIALLY_PAID → PAID / OVERDUE / CANCELLED.
- `InvoicePlan` + `InvoicePart`: the part-payment schedule. Each part, when issued, becomes its own Invoice
  (`planId`, `partSeq`, `InvoicePart.invoiceId`). Part status PENDING → ISSUED → PAID; MERGED when folded into one.
- `Payment`: `method` enum CASH | BANK | UPI | OTHER, `tdsAmount`, `tdsPercent`, `notes`.
- `RecurrenceRule.monthAnchor` NONE | START | END.
- `CompanySettings`: `stateCode`, `lutNumber`, `proformaPrefix`/`proformaNextNumber`,
  `creditNotePrefix`/`creditNoteNextNumber`, `invoiceWhatsappTemplate`, `reminderWhatsappTemplate`.
- Notification kinds: `INVOICE_APPROVAL_DUE`, `WORK_ON_HOLD`, `WORK_RESUMED`.

## Server contract (src/server/finance/*, all "use server" actions ADMIN-only, `ActionResult<T>` via `wrap()`)

Pure helpers (src/server/finance/tax.ts): `stateFromGstin(gstin) → {code,name}|null`,
`resolveTax({companyStateCode, client}) → { docType, taxMode, placeOfSupply }`,
`splitTax(taxable, gstPercent, taxMode) → { cgst, sgst, igst, total }`.

Actions (src/server/finance/invoices.ts):
- `createInvoice(input)` → `{ id, status }`. Input: `clientId`, `docType?` (TAX/EXPORT auto; PROFORMA opt-in),
  `plan` ONE_TIME | RECURRING | PART, `items[]` (or a single amount + description), `gstPercent?`, `description`,
  `dueDate?`, `recurrence?` (frequency, interval, monthAnchor, endDate), `parts?` [{kind, value, dueDate, description}]
  (PART: creates the InvoicePlan and issues part 1 as AWAITING_APPROVAL; later parts are issued by the job on their due
  date or by `issuePart`). Result status is always AWAITING_APPROVAL (never sent).
- `approveAndSend(id, { email: boolean, whatsapp: boolean, emailText?, whatsappText? })` → allocates the series number
  (invoice / proforma / credit-note series by docType), renders PDF, stores it, uploads to Drive (best effort),
  sends email (Gmail) and/or WhatsApp (Twilio, media = signed public PDF link) and sets SENT (or stays
  AWAITING_APPROVAL with an error if both fail). Audited.
- `pushForward(id, remindAtISO)` → sets `remindAt`; the job notifies admins (INVOICE_APPROVAL_DUE) on that day.
- `issuePart(planId, seq)` → creates that part's invoice (AWAITING_APPROVAL) early.
- `mergeRemainingParts(planId, { dueDate, description? })` → all PENDING parts become MERGED and one new part is created
  for the remaining amount; it is issued as AWAITING_APPROVAL.
- `updatePartSchedule(planId, parts[])` → edit PENDING parts only (amounts must still sum to the plan total).
- `convertProforma(id)` → creates the tax/export invoice from a proforma (AWAITING_APPROVAL); links both.
- `createCreditNote(invoiceId, { amount?, reason })` → CREDIT_NOTE document (AWAITING_APPROVAL; approve to send);
  full amount cancels the invoice (CANCELLED); partial reduces the outstanding balance.
- `holdWork(clientId, invoiceId)` / `resumeWork(clientId)` → pause/resume all open client tasks via the task lifecycle
  rules (status PAUSED with `statusBeforePause`), set/clear `workOnHold`, notify assignees + TLs (WORK_ON_HOLD /
  WORK_RESUMED). Marking the hold invoice fully paid resumes automatically.
- `sendReminder(id)` (existing) now also sends WhatsApp when the client has a number.
- `recordPayment({ invoiceId, amount, receivedAt, method, tdsAmount?, tdsPercent?, reference?, notes? })` → payment +
  receipt (receipt sending also goes through the confirm sheet: `sendReceipt(paymentId, { email, whatsapp })`).
  Invoice is PAID when payments + TDS + credit notes ≥ total.

Queries (src/server/finance/queries.ts): `listInvoices`, `getInvoiceDetail` (now includes tax split, plan/parts,
credit notes, approval + send state), `paymentsDashboard({ month?, method? })` → tiles (outstanding, overdue,
received this month, awaiting approval), due-in-7-days and overdue grouped by client, upcoming scheduled parts and
recurrences, cash vs bank split, `clientLedger(clientId)`, `awaitingApproval()`.

Routes: `GET /api/public/invoice/[token]` — unauthenticated PDF for WhatsApp media, token = Invoice.publicToken
(random 32 bytes, rotated on each approval). Existing authenticated file routes unchanged.

Integrations: `src/integrations/whatsapp.ts` — Twilio REST (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
`TWILIO_WHATSAPP_FROM`), mock when unset or `GOOGLE_MOCK=true`; `sentWhatsappLog` in mock mode for tests.
`src/server/finance/qr.ts` — UPI QR PNG for the PDF (`upi://pay?pa=<upiId>&pn=<company>&am=<total>&tn=<number>`).

Jobs (`src/jobs/invoices.ts`): (a) parts whose dueDate ≤ now and status PENDING → issue as AWAITING_APPROVAL and notify
admins; (b) recurring occurrences whose nextRunAt ≤ now → clone as AWAITING_APPROVAL and notify (never send);
(c) `remindAt` ≤ now → notify admins and clear it; (d) overdue flagging; (e) nothing is ever emailed/WhatsApped by a job.
