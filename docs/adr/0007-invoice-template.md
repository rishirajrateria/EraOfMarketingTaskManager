# ADR 0007 — Owner's invoice template, recurring day/time, send-channel choices, client currency

- Status: Accepted
- Date: 2026-10-10
- Extends: ADR 0005 (invoicing v2), ADR 0006 (TDS / PAN)

## Context

The owner already invoices clients from a fixed template (docs/reference/invoice-template-reference.png): A4,
Helvetica 9pt, logo + brand + title row, "Invoice To / Invoice From" columns, a "Pay To" bank block, a four-column
table, a right-aligned totals block, a signature bottom-left and a website / HSN / time footer. The generated PDF must
look the same so clients see no change. Recurring invoices need a chosen day of the month and a notification time,
nothing may ever be sent without approval, and the approve sheet needs a "download the PDF" option. Export invoices may
be raised in the client's currency.

## Decisions

### PDF renderer (`src/server/finance/pdf-base.ts`, `pdf.ts`, `pdf-receipt.ts`)
- Geometry: A4 portrait, margins 22pt, right column at x = 366pt, body 9pt Helvetica (matches the Arial of the
  reference), titles 14.5pt bold, rules 1.5pt dark (1pt under table header / rows). pdfkit's bottom margin is 0 so every
  element is positioned explicitly; the totals block is anchored so the bold "Total amount to be paid" line sits at
  y ≈ 773pt when the table is short (as in the reference) and flows down / onto a new page otherwise.
- Fonts: DejaVu Sans (+ Bold) ship in `src/server/finance/fonts/` (Bitstream Vera licence, `LICENSE` alongside) and are
  loaded with `doc.registerFont` from `path.join(process.cwd(), "src/server/finance/fonts/…")`. Only the ₹ glyph is
  drawn with DejaVu (baseline-aligned); digits stay Helvetica. The Dockerfile copies the fonts into the runner image and
  `next.config.ts` lists them in `outputFileTracingIncludes`. If the files are missing the renderer falls back to "Rs ".
- Content, top to bottom: meta line top-right (`Invoice No. <number>  dd/mm/yyyy`, `Proforma Invoice  <date>`,
  `Credit Note <number>  <date>`, `Draft invoice  <date>` for unnumbered documents); logo (60pt) + brand name + title
  (`Tax Invoice` / `Export Invoice` / `Proforma Invoice` / `Credit Note`); `Invoice To:` (business name, blank line,
  address, email, phone, GSTIN, PAN — empty lines omitted) and `Invoice From:` (legal name → companyName fallback, blank,
  address, email, phone, `GST No. - …`, `PAN No. / IEC Code - …`, `LUT No. …` when set); rule; `Pay To:` with Account
  Name / Account Number / Swift Code / IFSC Code / Bank Name / Bank Address (a 70pt UPI QR + "Scan to pay" sits to the
  right only when `upiId` is set and the document is an INR invoice); rule; table — `Description | Amount | Tax |
  Total Amount` for CGST/SGST and IGST documents, `Description | Total Amount` for export (0% LUT) and no-tax documents;
  a small info block (place of supply, due date, part label, terms, notes, "Against invoice" for credit notes); totals
  block (`Total amount :`, `CGST x% / SGST x%` or `IGST x%`, `Total Amount with tax`, gap, bold `Total amount to be
  paid  :` / `Total credit  :`; export prints `Supply meant for export under LUT No. …, without payment of IGST` instead
  of tax lines); signature image (≈210pt) with `Signature` centred, or legal name + `Authorised signatory` when no image;
  footer: website left, `HSN Code - <hsnSacCode>` centre, `h:mm am/pm IST` right (company timezone).
- Export invoices without a LUT number throw (`renderInvoicePdf`) — the owner must fill Settings → Company first.
- Amounts: `formatCurrency(n, currency)` → `₹30,000` (Indian grouping, no decimals when whole, else two) or
  `AED2,700` (ISO code directly before the number). `formatINRPlain` ("INR 30,000.00") stays for emails / WhatsApp;
  `formatMoney` ("AED 2,700.00" / "₹2,700.00") for UI rows.
- Receipts keep their body (payment details, settlement lines) but share the header, party columns, signature and
  footer.

### Company settings (CompanySettings + Settings UI)
- New fields (default ""): `legalName`, `pan`, `iecCode`, `email`, `phone`, `website`, `hsnSacCode` (default
  "998361"), `bankSwift`, `bankAddress`; `signatureData Bytes?` + `signatureUrl` (served from `/api/files/signature`,
  signed-in users only; uploaded / removed like the logo via `uploadSignature` / `removeSignature`).
- Settings → "Company (printed on every invoice)": brand name, legal name, GSTIN, State (auto-filled from the GSTIN's
  first two digits, still editable), PAN, LUT, IEC, HSN/SAC, billing address, email, phone, website, timezone.
  "Pay to (printed on every invoice)": account name / number, Swift/BIC, IFSC, bank name, bank address, UPI id.
  "Logo & signature": both uploads. `settingsInputSchema` validates PAN / email / state code; all new fields default to
  blank so older callers keep working.
- `prisma/seed.ts` loads `prisma/seed-assets/logo.png` + `signature.png` and the owner's real company details.

### Currency (`Client.currency`, `Invoice.currency`, both `String @default("INR")`)
- Indian clients are always billed in INR (schema + `createInvoiceRecord` force it). Clients outside India get a
  currency on the client form (defaulting from the country); the wizard shows a currency field on the amount step for
  them, defaulting from the client. Amounts are stored as entered — no FX. Clones, parts, proforma conversions and credit
  notes copy the source document's currency. Invoice list / detail rows print the code when ≠ INR.

### Recurring: day and time, never auto-send (`RecurrenceRule.dayOfMonth Int?`, `notifyMinutes Int @default(540)`,
`MonthAnchor.DAY`)
- Wizard "Bill on": 1st day / Last day / A date (1–28) + "Notify me at" (HH:MM, company tz, default 09:00).
  `recurrenceInputSchema` requires `dayOfMonth` for `DAY`.
- `nextOccurrence` / `anchoredMonthDate`: START / END / DAY land on that day of the following month at `notifyMinutes`
  local time; non-anchored frequencies also snap to `notifyMinutes` when it is set. Day 1–28 exists in every month.
- The job clones the occurrence as AWAITING_APPROVAL and notifies admins "Invoice for <client> is ready — approve to
  send"; `emailSentAt` / `whatsappSentAt` stay null until an Admin approves with a channel ticked.
- Non-recurring documents (one-time, part, proforma) accept an optional "Remind me to approve and send on" date + time →
  `Invoice.remindAt` at creation (parts: on the first issued part). The job notifies "Reminder: approve and send invoice
  for <client>" and clears it.

### Approve sheet
- Email + WhatsApp (preselected when the client has the contact) plus "Download the PDF" (off by default). The button
  reads "Confirm & send" when a channel is on, "Approve & download" when only download is on, "Approve only" when
  nothing is. The download opens `/api/files/invoice/<id>?download=1` (`Content-Disposition: attachment`) in a tab opened
  before the server call so popup blockers allow it; a failed approval closes it. Approving with no channel allocates
  the number and stores the PDF but sends nothing (`approve-core`).

### Client form
- State select is shown for Indian clients even without a GSTIN; the hint reads "Same state as you (<company state>) →
  CGST+SGST · other state → IGST" and the tax badge updates live. Currency select replaces it for clients abroad.

## Consequences
- Migration `20261010120000_invoice_template_schedule` (additive, defaults only). Existing rules keep START/END and get
  `notifyMinutes = 540`, so their next occurrence moves from 00:00 to 09:00 local.
- `documentTitle` / `taxRows` / `metaText` in `pdf.ts` changed shape (strings / numeric rows); the old
  "INR 1,800.00" rows are gone. `pdf-parse` (dev) extracts PDF text in tests.
