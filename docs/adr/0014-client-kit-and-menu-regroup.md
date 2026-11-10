# ADR 0014 — Client kit (Drive folders + credentials sheet) and menu regroup

- Status: Accepted (sharing revised 2026-10-10)
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
  rather than failing; a failure is a warning, never an error. Sharing after that uses the kit's own Share sheet
  (below). The ADR 0013 finance Share actions still accept the kit folder itself, never its parts.
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

### Sharing a kit (revised 2026-10-10, owner request; prototype `driveShare` with `scopes` + `team`)
- The kit pages' **Share** button opens a Google-Drive-style sheet (`src/components/clients/KitShareSheet.tsx`):
  - **What to share** pills: *Whole kit* · Brand kit · *Credentials sheet* · Work · Reports — only parts that exist,
    named from Settings. The Credentials pill shares the credentials **Google Sheet** (what the client opens), not its
    folder. The title follows: "Share “Client kit › Repo”" / "Share “Repo › Work”". Switching keeps the people being added.
  - **Your team**: one-tap chips (blue avatar initial, first name, TL / EXEC) for active Team leaders then Executives
    without *direct* access to this part (someone with whole-kit access is still offered on a sub-part, to give them
    more there). The email field stays for anyone else; it only adds rows.
  - **Adding · pick access for each**: one row per person (avatar, name or email local part, role tag + email, own
    Viewer / Commenter / Editor select defaulting to Viewer, ×), Notify people + message, Cancel / Send. Send creates
    one Drive permission per person with *their* role (`sendNotificationEmail` = the checkbox, `emailMessage`).
  - **People with access**: owner (fixed), rows set on this part (role select + Remove access → permissions.update /
    delete), and for a part also everyone who has it **via the whole kit**, read-only as "Editor · whole kit".
    General access (Restricted / Anyone with the link + role) and Copy link are per part; when only the whole kit's
    link is open the part shows "Anyone with the link · whole kit" read-only (change it under Whole kit).
- Split of direct vs inherited (`splitAccess`, pure): Drive's `permissionDetails[].inherited` when returned; otherwise a
  row the whole kit grants with the same role counts as inherited (live My Drive lists inherited access on children);
  the GOOGLE_MOCK store (in memory, as ADR 0013) keeps only direct rows per file, so kit rows are merged in. Changing or
  removing an inherited row from a part is refused ("change it under Whole kit").
- Actions `getKitSharing`, `shareKit`, `changeKitShareRole`, `removeKitShareAccess`, `setKitGeneralAccess`
  (`src/server/clients/kit-share.ts`): Admin only; input is `{ clientId, scope key }` (zod enum) resolved against the
  client's stored kit ids — no Drive id from the browser; people `[{ email, role }]` (1–25, unique, valid emails, not
  the owner). Audit on the client: `client.kit.share.add | role | remove | link` with scope, part name and file id.
- No schema change: permissions live in Drive (and the mock store). Avatars in both share sheets use the
  `#60a5fa → #2563eb` gradient with white text in light and dark (`ShareParts.tsx`, shared with the ADR 0013 sheet).

### Screens
- `/admin/client-kit`: every active client with kit status ("Kit ready · sent 3 Oct by email", "No kit yet",
  "Kit incomplete · tap Repair"), Create kit, or Share (kit sheet above) · Open · Email kit · WhatsApp kit, and a "Saved in the app" line.
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
