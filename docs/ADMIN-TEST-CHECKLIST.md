# Admin test checklist

Sign in as **Admin** from the demo chooser. Everything below is in the order a real day would go.

## 1. Setup (☰ menu)
- **Settings → Company (printed on every invoice)** → brand name, legal name, GSTIN (the State select fills itself from the
  first two digits — change it if needed), PAN (`ABC123` is rejected), LUT, IEC, HSN/SAC (998361), billing address, email,
  phone, website. **Pay to** → account name / number, Swift/BIC, IFSC, bank name, bank address, UPI id. **Logo & signature**
  → upload both (the seed already has the owner's); "Remove" clears them. Working hours, half-day hours, holidays, expense
  categories, invoice prefix as before. Save with the bar button.
- **Add Team** → add a team; each row lists its work types ("work: Content, Reels…"). Picking a leader in the team
  form moves that leader into the team.
- **Add Work** (ADR 0008) → list grouped by team ("SOCIAL · 4"; Reporting appears under every team; "Not in any team"
  for old rows). **+ Add work** → Name + **Teams** pills → Save without a team toasts "Pick at least one team". Tap a
  row's **edit** pill → change teams / **Remove** (deleted if unused, otherwise moved to "Removed" with **Restore**).
- **Add Executive / Add Team Leader** → add a person by email (demo users already exist). **Speciality** pills show only
  the chosen team's work types; switching the team drops specialities that no longer belong. Rows show "✓ Reels"
  chips. Adding a second Team Leader to Graphic → "Graphic already has a team leader". **Add Client** (vault "+") → name, **Business name** (printed on invoices), GSTIN
  (watch the tax badge: CGST+SGST / IGST / Export), **PAN** (try `ABC123` → rejected; `abcde1234f` → saved upper-case),
  email, WhatsApp, TDS %. With an empty GSTIN the **State** select is still there ("Same state as you (West Bengal) →
  CGST+SGST · other state → IGST") and the badge flips live as you pick a state. Pick a country outside India → the state
  select becomes a **Currency** select (USD / AED / …) and the badge reads Export Invoice.
- **Settings → TDS & GST pack** → threshold on expenses (default ₹20,000; "per payee, per financial year"; salaries not
  counted) and **Finance person's email** (where the monthly GST pack goes).

## 2. Tasks (dashboard)
- **Capacity header**: Admin **+** opens full screen with **no** cyan header. Tap a team → a slim cyan strip slides in:
  four cells **TODAY / TOM / WEEK / MONTH**, each "13h left" (bold) and "2h booked" (muted) for everyone in that team
  (Team Leader + executives); pick a second team → the numbers add up; untap all teams → it slides away. Team Leader /
  Executive: the strip shows their own team straight away (none if they have no team).
- **+** → task: title, description (small mic in the toolbar = dictation). The body has **no date / time inputs**: under the
  pills it reads "📅 Next free slot: Tom 10:00am · 2h · change with the calendar icon below".
  - **How long**: tap ½h … 8h (selected pill is dark in light mode, light in dark mode), − / + steps 15 minutes, never
    below 15 minutes.
  - **Voice note**: tap the big round mic → it turns red and pulses with a live 0:07 timer → tap again → a chip
    "🎙 0:07 ▮▮▮ ▶ ✕" appears (▶ plays, ✕ removes); several notes are fine. After Save they are on the task as voice notes
    (mic icon on the row → detail sheet).
  - **⟳ Recurring** → "Repeat this task": the blue summary updates live; Quick pick (Every day / weekday / Fri / 2 weeks /
    month on the 9th / month, last day / 3 months / year) or set it yourself (Weekly → Mo–Su toggles, Monthly → a date
    incl. "Last day of the month" or "The last Fri", every N), **Ends** Never / After 5 times / Until a date → Done →
    toast "Repeats: …" and the pill shows the summary. Reopen → **Don't repeat** clears it. After Save the detail sheet
    shows "↻ Every 2 weeks on Fri".
  - **Calendar icon** in the bottom bar → "When should it start?" (date + start time) → **Set** → line reads
    "📅 12 Oct 2026 at 15:30 · …"; **Next free slot** (or **upnext**) goes back to the auto slot; **Tom** / **today** as before.
  Green rows (labels on
  the left): only **TEAM** + **CLIENT** at first and the card says "Pick a team below." Type a title, Save → "Pick a team in the
  green area". Tap **Social** → **WORK** (Social's work types, first one selected) and **PREFER** appear above TEAM;
  the card reads "Goes to Neha (TL, Social)" · "No executive preference · tap names in the PREFER row" ·
  "✓ Content specialists: Isha". Tap **Arjun** in PREFER → "★ Arjun", card "Your preference: Arjun · the Team Leader
  decides". Tap **SEO** only → "— no Team Leader in this team yet", Save →
  "That team has no Team Leader yet (Menu → Add teamleader)". Pick Graphic + Logo + a client, leave it on upnext →
  Save. The row shows an amber **pref: arush** chip next to the client.
- Switch to **Team Leader** (Rishi) → the "[demo] Festive logo refresh" row shows "pref: arush" → long-press →
  **Assign executive** ("Admin prefers Arush · you decide") → "me (Rishi)", "★ Arush ✓", "Dev"; Arush is pre-selected →
  Assign → toast "Assigned to Arush", the chip disappears, Arush gets "New task from Rishi: …" in 🔔.
  Team Leader **+**: **WORK** (Graphic's work types) · **EXEC** ("me", specialists first with ✓) · **CLIENT**; nothing
  picked → "Your whole team · tap names in the EXEC row to pick".
- Executive **+**: **WORK** + **CLIENT** only. Executive dashboard green row 2 lists only their team's work types.
- Long-press the row → **Start** (green). Tap the circle → finish requested → **📥 Requests** → Approve (grey, Restart button).
- Long-press → **Pause** (⏸ badge) → Resume. Long-press → **Edit** (clears a red dot). Long-press → **Delete** (3 checkboxes).
- Switch to **Team Leader** (Demo chip) → long-press → **Raise doubt** (yellow) and **Review request** (red dot); back as
  Admin → Requests inbox → Unflag / Edit.
- Bottom green rows filter by team/client; the white strip filters restarted / completed / recurring / paused / colours.
- **Meetings (ADR 0012)** — Meet icon in the bar:
  - [ ] The body has **no ★ Important** and **no voice-note mic** (the toolbar dictation mic stays); ⟳ Recurring,
    👥 Guests and ⚙ Options are there; the description placeholder says it is the
    agenda. **Duration** pills 15m 30m 45m 1h 1½h 2h (30m selected) + − / + in 15 minutes.
  - [ ] Green rows: **TEAM** (multi-select = invite that team's Team Leader only) · **CLIENT** · **START** (9 am … 8 pm every 30
    minutes, then **Custom…** opens the time picker). Tap **4 pm** → **upnext** turns off and the line reads
    "📅 Today 4:00pm–4:30pm · 30m · 3 guests" (tomorrow when 4 pm has passed); **Tom** keeps 4 pm and moves the day.
  - [ ] Pick **Repo** → its email appears under "Guests:" in the card and the people glyph badge counts it; a client with
    no email shows "<client> has no email — add one in Clients". Pick **Graphic** → only its Team Leader is invited
    ("Inviting me, Rishi · Graphic (Team Leader)"); with no client and no team the card shows no "null" text.
  - [ ] **👥 Guests** (or the people glyph): "From client" chip (✕ removes), "From teams · Graphic" with
    "Rishi Kumar · Team leader" (✕ un-invites the team), **Your people** (you are "(organiser)"; executives unselected
    until tapped), **Add guests**: type an address + Enter,
    or paste "a@x.co, b@y.co" → two chips; "bad" → toast "Not an email: bad".
  - [ ] **⚙ Options**: Add Google Meet (off → the chip says "· no Meet" and the saved meeting has no Meet link), All day
    (hides START and Duration; line "📅 Tom · all day · …"), Notifications (Notification / Email, number, min / hours /
    days / weeks; "+ Add notification" disappears at 5), Guest permissions (Modify off, Invite others on, See guest list
    on), Location, Busy / Free, Default / Public / Private, 11 colour swatches + Calendar colour, Time zone (company zone
    marked; another zone is named at the end of the line and the start time is in that zone).
  - [ ] **Find a time** (from Guests or Options): each internal guest's busy bars between 8 am and 9 pm, a green "Free"
    lane and the first three free slots; tap one → START shows that time. Hint: outside guests aren't checked.
  - [ ] **Schedule** → toast "Meeting scheduled". Open it (i): **Meeting details** with **Join Google Meet**, People,
    Guests (emails), Location. Long-press → **Edit** → "Edit meeting" shows **Outside guests** chips and **Meeting
    options**; change them → Save → "Meeting updated · Google Calendar emails the guests".
  - [ ] With real Google (GOOGLE_MOCK off): the event is on the company calendar with the Meet link, reminders, colour,
    location, visibility and guest permissions; every guest gets the Calendar invite email.
  - [ ] Team Leader: the Meet icon works the same (TEAM row instead of EXEC, header = own team).
- **Look (glass refresh)**: rows are floating glass cards with a coloured left edge (green ongoing, amber doubt, red
  overdue, grey done); chips wrap instead of being cut off. Switch the phone / browser to **dark mode** → every screen
  (dashboard, add task, sheets, menu, admin lists) turns dark glass, selected pills stay readable.

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
- **Cancel a sent invoice** (ADR 0009): on a Sent / Overdue invoice with no payments → green pill **Cancel invoice** →
  sheet shows Client, Amount, "Number EOM/…/0003 · stays used", "Next invoice EOM/…/0004", a required Reason, "Tell the
  client by email" / "on WhatsApp", and "Already reported this invoice in your GST return? Issue a credit note instead of
  cancelling." → **Keep it** / **Cancel invoice**. The page shows the red banner (Cancelled on …, Reason, "Number … stays
  used …", filed in Drive › Finance › YYYY-MM › Cancelled invoices); **Preview** has the big rotated CANCELLED stamp and
  the reason. The next approved invoice takes the "Next invoice" number. On an invoice with a payment or credit note the
  pill toasts "This invoice has payments. Use a credit note to reverse it." A part-plan invoice cancels its pending parts;
  a hold tied to it is released. Invoice list: the **Cancelled** tab has it; **All** and the tiles leave it out.

## 4. Back office
- **Expenses = payables** (ADR 0009). Tabs in the green zone: **To pay · Paid · GST credit · All bills · TDS by payee**.
  - **+ Add expense** opens the bill editor page: amount, Regular / Salary (salary → team member, "Salaries", Postpaid,
    monthly on the last day), payee (suggests earlier payees), category with **+ New** (appears in Settings → Expenses),
    Prepaid / Postpaid / Advance, schedule **One time** (due on, "Already paid" + method) / **Recurring** (first due + the
    ⟳ repeat picker: quick picks, Daily…Yearly, every N, weekdays, "On a date" incl. last day or "On a weekday" incl.
    last, ends never / after N / until) / **Part payments** (fixed ₹ or %, must add up), Remind me (on the day … 1 week).
  - **To pay**: tiles Overdue / Due in 7 days / Due this month / Paid this month; groups Overdue (red rows), Next 7 days,
    Later; each row has category / Salary / timing / schedule tags, "due in N days" and **Mark paid**.
  - **Mark paid** sheet: amount (pay less → "Part paid · balance ₹… still due" and a "Balance of …" row stays), paid on,
    Cash / UPI / Bank transfer / Card / Cheque, reference, **Bill & GST** (attach PDF/photo ≤ 12 MB, "This bill includes
    GST", 5/12/18/28 % → GST auto = amount × rate / (100 + rate), editable, vendor GSTIN, "I'll get this GST back"; without
    a file: "Attach the bill: the claim needs …"), TDS toggle (% → amount). Paying a recurring bill shows "· next ₹… on dd
    Mon"; a part plan "· next: Part 2 of 2 … " / "· all parts paid".
  - Tap a row → sheet with details + Mark paid / Move the due date / Skip this one (recurring) / Undo paid / Bill & GST
    details / Edit schedule. After a payment the editor says the schedule can't change; a new amount updates future dues.
  - **Paid**: Paid · 30 days, TDS deducted · FY, by category; rows with method, TDS · net, GST · claimable, 📎 bill / no bill.
  - **GST credit**: month ‹ › navigator, "GST you'll get back", "Bills attached n / m", amber missing-bill warning,
    Claimable vs "GST paid, not claimable"; bar: **Drive** (opens Finance › YYYY-MM › GST claimable), **Download** (ZIP of
    bills + summary.csv), **Send** (finance email, saved in Settings; mock mail in GOOGLE_MOCK).
  - **TDS by payee**: paid basis this FY, salaries excluded, "over threshold · deduct TDS" / "₹… left before threshold".
    Paying a payee over the threshold without TDS toasts the warning and drops a 🔔 "TDS threshold crossed".
  - Reminders: the payables job (`/api/jobs/payables`) sends 🔔 "Payment due in 3 days: Skyline Spaces ₹25,000 · Rent" /
    "Overdue: …" once per payment, `remindDays` before the due date.
  - **Export** (Paid basis CSV with TDS + GST columns) and the Expenses sheet mirror.
- ☰ → **Monthly Drive folders**: this FY's months newest first, each with Sales invoices / Expense bills / GST claimable
  (₹) / Cancelled invoices counts, **Open in Drive** and **GST pack ›** (jumps to the GST credit tab for that month).
- **Finance sheet** → tiles (expenses on a paid basis, plus **To pay · 30 days**, **Overdue to pay**, **GST to claim ·
  <Mon>**, **Expense bills attached · n this month**), charts, push to Google Sheet (mock); **TDS · FY** section:
  receivable, deducted on expenses, by client; **Previous FY** toggle.
- **Attendance** (HR/Admin mark cells), **Leave** (request as a demo Executive, approve as HR, then "shift tasks" as Admin).
- **Inventory** → Day (hourly grid), Week, Month, Quarter, Year.
- **Client vault** → add a credential, grant a Team Leader access for 10 minutes after first open, switch role and reveal it.


## Menu (ADR 0011)
- [ ] ☰ opens a bottom sheet; tapping outside, ✕ or Escape closes it.
- [ ] Search filters rows (try "gst", "team"); "Nothing matches" when empty.
- [ ] Badges: Invoices shows the number awaiting approval; Expenses shows overdue (red) or due this week (amber); Requests and Notifications show their counts.
- [ ] Quick actions open New task, New invoice, Add expense and Add client.
- [ ] Opening the menu from the dashboard and from any admin page shows one sheet only.
