# Admin test checklist

Sign in as **Admin** from the demo chooser. Everything below is in the order a real day would go.

## 1. Setup (☰ menu)
- **Settings** → company name, address, GSTIN (state is derived from it), bank + UPI id, logo, working hours, half-day hours,
  holidays, expense categories, invoice prefix. Save with the bar button.
- **Add Designation** → add a team. **Add Work** → add a work-type tag. **Add Executive / Add Team Leader** → add a person
  by email (demo users already exist). **Add Client** (vault "+") → name, **Business name** (printed on invoices), GSTIN
  (watch the tax badge: CGST+SGST / IGST / Export), **PAN** (try `ABC123` → rejected; `abcde1234f` → saved upper-case),
  email, WhatsApp, TDS %.
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
- **+ New invoice** → client (tax badge) → amount + description → plan: One time / Recurring (monthly on 1st or last day) /
  Part payment (50/30/20 with dates) → review → Save (awaiting approval).
- Open it → **Approve & send** → both channels ticked → Confirm. Number becomes EOM/26-27/0001; "Email sent / WhatsApp
  sent" (mock) appear; PDF via Preview.
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
