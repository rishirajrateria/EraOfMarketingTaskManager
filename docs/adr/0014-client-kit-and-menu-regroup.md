# ADR 0014 — Client kit (Drive folders + credentials sheet) and menu regroup

- Status: Accepted
- Date: 2026-10-10
- Extends: ADR 0011 (menu), ADR 0013 (owner's Drive + Share sheet); SPEC §11.1 (client vault)

## Context

Onboarding a client means chasing logos, fonts and logins over WhatsApp. The owner wants one Google Drive folder per
client in *their* Drive: a place the client uploads brand assets, a ready-made sheet for logins, a place we deliver work
and reports — created in one tap and sent by email or WhatsApp. In the menu, "Asset drive links" and "Credentials" were
two rows for the same idea, and the Team section mixed people management with time tracking.

## Decisions

### Drive structure (owner's My Drive, via domain-wide delegation as in ADR 0013)
- `Client Kit` (top folder, created once at the impersonated owner's My Drive root; id cached in
  `CompanySettings.clientKitRootId`) › `<client business name, else client name>` (sanitised like file names) › four
  folders. Their names live in `CompanySettings.clientKitFolders` (Settings › Client kit folders), default
  **Brand kit · Credentials · Work · Reports**. The owner named three; "Reports" is the fourth default and can be renamed.
- Inside Credentials: a Google Sheet "`<client> — Credentials`" created straight in the folder (Drive `files.create` with
  the spreadsheet MIME type), then one Sheets `batchUpdate` + one values write (`src/google/kit-sheet.ts`):
  - tab **Credentials**: header `Platform | Login URL | Username / email | Password | Way | 2FA code goes to | Notes`,
    bold, grey fill, frozen; "Way" has a strict dropdown (Email & password, Sign in with Google / Microsoft / Apple /
    Facebook, Phone OTP, Other) for rows 2–1000; three example rows in grey italics (Instagram via Facebook, Google Ads
    via Google, a website with email & password); a note on A1 and the file description point to the guide tab.
  - tab **How to fill**: one numbered line per rule (one row per platform; what each column and "Way" mean; with
    "Sign in with Google" give that email and leave Password blank; who receives 2FA codes; never put bank details,
    card numbers, UPI PINs or OTPs; examples can be overwritten; whom to contact).
- The client folder is shared with the client's email as **Editor** with `sendNotificationEmail: false` (we send our own
  message). Drive refuses that for non-Google addresses, so it then retries with Drive's invitation (with a short note)
  rather than failing; a failure is a warning, never an error. The kit folder is accepted by the ADR 0013 Share sheet
  (owner can change roles / link sharing); its subfolders and other client folders are not.
- Idempotent: "Create kit" again (shown as **Repair**) keeps every stored id that still exists (`fileAlive`), recreates
  only missing folders / the sheet (find-or-create by name, so nothing is duplicated) and re-shares only if needed.
  Audit: `client.kit.create` / `client.kit.repair` with what was created.
- Live mode refuses to create kits without `GOOGLE_IMPERSONATE_USER` (they would land in the service account's drive).
  GOOGLE_MOCK works end to end with deterministic ids (`mockSheetLog`, in-memory permissions).

### Data (migration `20261010200000_client_kit`)
- `Client`: `kitFolderId`, `kitBrandId`, `kitCredentialsId`, `kitSheetId`, `kitWorkId`, `kitReportsId`, `kitCreatedAt`,
  `kitSharedWith`, `kitSentAt`, `kitSentVia` (EMAIL | WHATSAPP, last send). URLs are derived from the ids
  (`kitUrls`). `CompanySettings`: `clientKitRootId`, `clientKitFolders text[]`.
- `clientWorkFolderId(client)` (pure, `src/server/clients/kit-paths.ts`) returns the kit's Work folder (or null) — the
  hook for creating new task folders inside it; `src/google/task-integrations.ts` is not changed here.

### Sending
- "Email kit" (Gmail, as for invoices) and "WhatsApp kit" (Twilio helper, WhatsApp number else phone) open one send
  sheet with an editable friendly message (folder link; upload brand assets to Brand kit; fill the Credentials sheet
  using the How to fill tab, no bank details; our work appears in Work; reports in Reports). A channel without contact
  details is shown disabled with a hint to add it on the client. `kitSentAt` / `kitSentVia` recorded, audited
  `client.kit.send`.

### Screens
- `/admin/client-kit`: every active client with kit status ("Kit ready · sent 3 Oct by email", "No kit yet",
  "Kit incomplete · tap Repair"), Create kit, or Share · Open · Email kit · WhatsApp kit, and a "Saved in the app" line.
- `/admin/client-kit/[clientId]`: the folders and sheet with links, the same actions plus Repair, and **Saved in the
  app** — that client's asset drive links and credentials from the encrypted vault (labels / usernames only; reveal and
  grants stay in `/admin/vault`, which is linked). Clients list rows link to the kit.
- Actions `createClientKit`, `sendClientKit` (`src/server/clients/kit.ts`): Admin only, zod-validated.

### Menu (ADR 0011 revised)
- Clients: Clients · **Client kit** ("4 of 6 clients have a kit · 3 saved logins") · Shared drive links. The separate
  Asset drive links / Credentials rows are gone (both reachable from Client kit).
- Team: Executives · Team leaders · Teams · Work types (purple).
- New **Time & attendance** section: Attendance · Inventory, amber → orange icons (readable in light and dark).

## Consequences
- Existing vault data is untouched and still reachable. Renaming kit folders in Settings affects new kits and repairs
  only; existing Drive folders keep their names.
- A real deployment needs the Drive and Sheets scopes already granted to the service account.
