# ADR 0018 — Two sign-in domains and a finance sender mailbox

- Status: Accepted
- Date: 2026-10-10
- Extends: SPEC §1 (Google Workspace sign-in, service account with domain-wide delegation), SPEC §4 (workspace-domain
  rule for people), ADR 0005 / 0009 (invoice, receipt, reminder, cancellation and GST-pack mails)
- Code: `src/lib/domains.ts`, `src/lib/env.ts`, `src/lib/auth.ts`, `src/server/admin/people.ts`, `src/google/gmail.ts`,
  `src/google/client.ts` (`gmailAs`, `asWorkspaceUser`, `isDelegationError`), `src/google/calendar.ts`
  (`listLeaveEvents`), `src/google/chat.ts`

## Context
The owner's facts (10 Oct): the admin's email is `contact@eraofmarketing.com`, employees are on
`@theeraofmarketing.com`, and all finance mail must go from `finance@theeraofmarketing.com`. Until now the app allowed
exactly one domain (`GOOGLE_WORKSPACE_DOMAIN`), sent every mail from `GOOGLE_IMPERSONATE_USER`, and assumed every user
could be impersonated through domain-wide delegation (DWD).

## Decisions

### Allowed domains
- `GOOGLE_WORKSPACE_DOMAIN` takes a comma-separated list, staff domain first:
  `theeraofmarketing.com,eraofmarketing.com`. `GOOGLE_WORKSPACE_DOMAINS` is an alias; both are merged (lower-cased,
  leading `@` dropped, de-duplicated). `env.workspaceDomains` is the list; `env.workspaceDomain` stays as the first one
  for older call sites.
- **Sign-in** is allowed for any listed domain, and for any address in `BOOTSTRAP_ADMIN_EMAILS` (even outside the
  domains). Nothing configured = any domain (dev). Google's `hd` parameter can name only one domain, so it is sent only
  when exactly one is configured; with two, the server-side check is the gate.
- **Invites** (`assertWorkspaceEmail`) accept any listed domain; the error lists them: "Email must end with
  @theeraofmarketing.com or @eraofmarketing.com". The People form shows the staff domain as the placeholder
  (`name@theeraofmarketing.com`) and the same "Must end with …" hint. The login page and Settings → Google integration
  status show every domain.

### Which mailbox sends what
`sendMail({ …, sender: "finance" })` picks the finance mailbox; anything else uses the default.

| Mail | Code | Sender |
|---|---|---|
| Tax / export invoice, proforma, credit note (approve and send) | `server/finance/approve-core.ts` | finance |
| Cancelled-invoice notice to the client | `server/finance/cancel-core.ts` | finance |
| Payment receipt / thank-you | `server/finance/payment-core.ts` | finance |
| Payment reminder to the client | `server/finance/reminder-core.ts` | finance |
| GST credit pack to the accountant | `server/finance/gst-pack.ts` | finance |
| Invoice-approval and bills-due reminders to the admin (push + email via `remind()` / `notify()`) | `lib/email.ts` | default |
| Task / meeting notifications | `lib/email.ts` | default |
| Invite to a new person | `server/admin/people.ts` | default |
| Client kit | `server/clients/kit-core.ts` | default |

There are no vendor / payables emails today; if one is added it should use `sender: "finance"`.

- `GOOGLE_FINANCE_SENDER` (e.g. `finance@theeraofmarketing.com`). Finance mail is sent through a Gmail client that
  impersonates that mailbox (JWT subject = finance sender, scope `gmail.send` only), so the message is in the finance
  mailbox's Sent folder, the From is genuine (no "on behalf of"), and replies land there. Headers:
  `From: "<Company name> Finance" <finance@…>` and the same `Reply-To`; the company name comes from Settings (bare
  address if Settings can't be read).
- Unset → finance mail falls back to `GOOGLE_IMPERSONATE_USER` (still with the "<Company> Finance" display name).
- Mock mode records `sender` (kind) and `from` (mailbox) in `sentMailLog`, plus `fromHeader` and `replyTo` in
  `sentMailDetails`, so tests assert the sender for every finance path.
- Settings → Google integration status shows "Finance mail from: <addr>" (or the impersonated user marked "(default)").

### DWD must cover the finance mailbox
DWD can only impersonate users of the Workspace the service account's client id is authorised in. The finance mailbox
must be a real user (not a group or alias) in the same Workspace as `theeraofmarketing.com` / `GOOGLE_IMPERSONATE_USER`.
The existing DWD entry already lists `https://www.googleapis.com/auth/gmail.send`, which is all the finance token asks
for; nothing new has to be added to the scope list.

### If eraofmarketing.com is a separate Google Workspace
Then the admin (`contact@eraofmarketing.com`) is an **external-domain user for every Google call**:
- Calendar invites, Meet links and emails to them work as for any guest.
- **Per-user reads are skipped.** The only per-user impersonation is leave sync's Calendar read (`listLeaveEvents`,
  `calendarAs(email)`). It now runs inside `asWorkspaceUser()`: a token refusal (`unauthorized_client`,
  `invalid_grant`, …) is logged once, remembered for the process, and treated as "no leave events" — the job carries on
  for everyone else and reports no error. Free/busy reads (`freeBusy`, `freeBusyMany`) already go through the
  impersonated organiser and skip calendars Google won't share; availability and task saves are never blocked
  (Google work is queued, ADR 0002).
- **Chat**: a space whose setup is refused because of an external member is created with the organiser's-domain members
  only, and the others are added one by one; refusals (400/403/404) are logged and skipped instead of failing the job.
  Whether they can actually join depends on the Workspace allowing external Chat.
- **Drive** sharing with them follows the Workspace's external-sharing policy (unchanged here).
- **Sign-in**: an OAuth consent screen of type *Internal* only admits the Cloud project's own Workspace, so the
  consent screen must be *External* (published) for that admin to sign in. The server-side domain check still restricts
  who gets in.

If eraofmarketing.com is instead a secondary domain of the same Workspace, everything above just works (delegation
covers it), and nothing is skipped.

## Consequences
- One code path for both setups; nothing to switch when the domains are merged later.
- The finance mailbox needs a Gmail licence (it is a real user).
- An admin outside the Workspace won't have Google-Calendar leave imported automatically (they can raise leave in the
  app), and a warning appears once per process in the logs.
