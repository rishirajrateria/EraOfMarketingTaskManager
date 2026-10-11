# ADR 0004 — Product decisions confirmed with the client (Sept 2026)

Status: accepted · Date: 2026-09-11

Confirmed as built (no change): finish flow (TL requests, Admin approves), overdue notifies once, Executives view +
raise requests only, restart creates a new Drive/Meet/Chat, slot preview then Accept, soft blocks auto-shift + notify,
pause shifts the scheduled end, doubt unflag with optional note, vault access set per grant, tap-to-reveal secrets,
Admin-only expenses, leave via form + Google Calendar with HR approval, one team per person, work types as tags only,
Mon–Sat 10:00–19:00 with 13:30–14:30 lunch, one Chat space per task, meetings as rows with a Meet link, delete sheet
with three pre-checked boxes, no Team Leader menu, dd/M/yy + 12h + ₹, PWA via Add to Home Screen.

Changed:

| Area | Decision |
|---|---|
| Expense categories | Fixed list managed in Settings (no free text). |
| Invoice numbers | Financial-year based: `EOM/25-26/0001`; counters reset every 1 April. Receipts `EOM-RCP/25-26/0001`. |
| Advance invoices | Balance invoice mode per invoice: on a date, manual, or automatic when the client's tasks are all complete — the automatic one is generated as a DRAFT and Admin is asked to review before sending. |
| Payment reminders | Manual "Send reminder" button on the invoice (email with PDF); no automatic reminders. |
| Finance sheet | Push-only mirror to Google Sheets; no import from the sheet. |
| CA access | Parked. No CA login; Admin shares finance data with the accountant manually. |
| Attendance | HR/Admin mark everyone; no self check-in. Staff see their own month read-only. |
| Half day | Hours configurable in Settings (`halfDayMinutes`). |
| Inventory views | Day (with hourly breakdown), Week, Month, Quarter, Year (financial), Custom. |
| Notifications | In-app + push by default; posting into task Chat spaces is off unless enabled in Settings. |
| Hosting | Single always-on container (Render / Railway / any Docker host) + managed Postgres, so SSE and the inline job runner work in one process. Vercel remains documented as an alternative. |
