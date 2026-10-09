# Admin test checklist

Sign in as **Admin** from the demo chooser. Everything below is in the order a real day would go.

## 1. Setup (☰ menu)
- **Settings → Company (printed on every invoice)** → brand name, legal name, GSTIN (the State select fills itself from the
  first two digits — change it if needed), PAN (`ABC123` is rejected), LUT, IEC, HSN/SAC (998361), billing address, email,
  phone, website. **Pay to** → account name / number, Swift/BIC, IFSC, bank name, bank address, UPI id. **Logo & signature**
  → upload both (the seed already has the owner's); "Remove" clears them. Working hours, half-day hours, holidays, expense
  categories, invoice prefix as before. Save with the bar button.
- **Add Team** → add a team. **Add Work** → add a work-type tag. **Add Executive / Add Team Leader** → add a person
  by email (demo users already exist). **Add Client** (vault "+") → name, **Business name** (printed on invoices), GSTIN
  (watch the tax badge: CGST+SGST / IGST / Export), **PAN** (try `ABC123` → rejected; `abcde1234f` → saved upper-case),
  email, WhatsApp, TDS %. With an empty GSTIN the **State** select is still there ("Same state as you (West Bengal) →
  CGST+SGST · other state → IGST") and the badge flips live as you pick a state. Pick a country outside India → the state
  select becomes a **Currency** select (USD / AED / …) and the badge reads Export Invoice.
- **Settings → TDS** → threshold on expenses (default ₹20,000; "per payee, per financial year").

## 2. Tasks (dashboard)
- **+** → task: title, description (mic for dictation), record a voice note (mic on the dark bar), pick client and a team
  pill (its Team Leader is assigned), leave the time empty → "Proposed slot" → Send. Row appears white.
- Long-press the row → **Start** (green). Tap the circle → finish requested → **📥 Requests** → Approve (grey, Restart button).
- Long-press → **Pause** (⏸ badge) → Resume. Long-press → **Edit** (clears a red dot). Long-press → **Delete** (3 checkboxes).
- Switch to **Team Leader** (Demo chip) → long-press → **Raise doubt** (yellow) and **Review request** (red dot); back as
  Admin → Requests inbox → Unflag / Edit.
- Bottom green rows filter by team/client; the white strip filters restarted / completed / recurring / paused / colours.
- Meet icon in the bar → schedule a meeting (Calendar + Meet row, no Drive/Chat).

## 3. Invoicing (☰ → PAYMENT Creator)
- **+ New invoice** → client (tax badge) → amount + description (for a client abroad a **Currency** field appears,
  defaulting from the client) → plan: One time / Recurring / Part payment (50/30/20 with dates) → review → Save
  (awaiting approval).
  - Recurring → Monthly → **1st day / Last day / A date** (day 1–28 select) + **Notify me at** (default 09:00). The
    review step shows "monthly on the 15th at 10:30"; the invoice page shows it under Recurrence. Nothing is ever sent
    by the schedule — each occurrence lands in the approval queue with a 🔔 "Invoice for <client> is ready — approve to
    send".
  - One time / Part / Proforma → optional **Remind me to approve and send on** (date + time) → shows as "⏰ Reminder" on
    the invoice; on that day a 🔔 "Reminder: approve and send invoice for <client>" arrives and the reminder clears.
- Open it → **Approve & send** → Email + WhatsApp are ticked when the client has them; tick **Download the PDF** too →
  Confirm & send. Number becomes EOM/26-27/0001; "Email sent / WhatsApp sent" (mock) appear; the PDF opens in a new tab
  as a download. Untick both channels → the button reads **Approve & download** (or **Approve only** with download off)
  → the number is allocated and the PDF stored, nothing is sent.
- **PDF (Preview)** matches the owner's template: "Invoice No. … dd/mm/yyyy" top right, logo + The Era Of Marketing +
  Tax Invoice, Invoice To / Invoice From (GST No., PAN No. / IEC Code, LUT No.), Pay To (Swift, IFSC, bank address),
  Description | Amount | Tax | Total Amount, `₹30,000`-style amounts, CGST 9% / SGST 9% (or IGST 18%), bold "Total amount
  to be paid", signature bottom-left, footer "www… · HSN Code - 998361 · 3:32 pm IST". Export invoices: two columns,
  "Supply meant for export under LUT No. …" and `AED2,700`-style amounts; Proforma: no tax lines; Credit Note: "Total
  credit". With a UPI id set a small "Scan to pay" QR sits beside Pay To.
- **Push forward** → pick a date (reminder lands in 🔔 on that day). **Hold work** → client's tasks pause (check the
  dashboard) → **Resume work**.
- Step 1 of the wizard shows **"This client will deduct TDS"** (on when the client has a TDS %); step 4 repeats it.
  The invoice page shows "TDS deducted by client · 10%" / "No TDS expected" under Client.
- **Record payment** → amount, Cash/Bank/UPI, TDS → invoice Paid → **Send receipt**. With TDS expected the % / amount
  are pre-filled; otherwise they sit behind "Client deducted TDS?" — turn it on, record TDS, and the invoice flips to
  "TDS deducted by client".
- Preview the PDF: bill-to shows the business name and `PAN: …`.
- **Credit note** (reduce or cancel) → approve & send it. Try **Proforma** on step 4 and **Convert to invoice** later.
- Part plan: **Issue now**, **Edit schedule**, **Merge remaining into one**.
- ☰ → **Payments**: tiles, awaiting approval, due soon, upcoming parts, outstanding by client, client ledger.

## 4. Back office
- **Expense** → add with photo + voice note, filter by month/category, export CSV (has tds columns).
- **Expense TDS** → add ₹12,000 then ₹8,000 to the same vendor (vary the case): the amber banner "Paid ₹20,000 to … this FY
  (threshold ₹20,000). TDS applies." appears live; saving without **Deduct TDS** toasts the warning and drops a 🔔
  "TDS threshold crossed" notification. Tick **Deduct TDS** → % → amount auto-fills, "Net payable" shown; the row gets a
  "TDS ₹…" chip. **TDS** zone pill → per-payee FY sheet (paid / TDS deducted / status).
- **Finance sheet** → tiles, charts, push to Google Sheet (mock); **TDS · FY** section: receivable, deducted on expenses,
  by client; **Previous FY** toggle.
- **Attendance** (HR/Admin mark cells), **Leave** (request as a demo Executive, approve as HR, then "shift tasks" as Admin).
- **Inventory** → Day (hourly grid), Week, Month, Quarter, Year.
- **Client vault** → add a credential, grant a Team Leader access for 10 minutes after first open, switch role and reveal it.
