# EraOfMarketing Task Manager

Mobile-first task manager for a marketing agency: Google-Tasks-style list with hierarchy (Admin → Team Leader →
Executive), time-based scheduling, sellable-hours inventory, deep Google Workspace automation (Drive folder, Calendar +
Meet, Chat space per task) and an Admin back-office (client vault, expenses, invoices, finance sheet, attendance,
inventory). Product spec: [`docs/SPEC.md`](docs/SPEC.md). Architecture decisions: [`docs/adr/`](docs/adr/).

## Stack

Next.js 15 (App Router, Server Actions) · TypeScript · Tailwind v4 · Prisma + PostgreSQL · NextAuth v5 (Google) ·
googleapis (service account with domain-wide delegation) · pdfkit · web-push · vitest. Installable PWA with offline
shell and push notifications. Jobs run in-process (`JOBS_INLINE=true`); Render is the deployment target.

## Throw-away demo link on Render (staging only)

The blueprint in `render.yaml` is **safe by default**: demo sign-in off, no demo data, real Google. To get a demo link
with sample data and mocked Google (never with real client data), set these in the Render dashboard **on a separate
demo service**: `DEMO_LOGIN=true`, `SEED_DEMO=true`, `GOOGLE_MOCK=true` and the explicit, unsafe
`ALLOW_DEMO_IN_PRODUCTION=true` (see "Production safety checks" below). The login page then shows **Try a demo role**.
Free-tier services sleep after 15 minutes idle and the free database expires after 30 days; do not use them for
anything real.

## Try the three dashboards on your laptop (no Google setup)

Needs Docker Desktop (or Node 22 + Postgres, see below).

```bash
git clone https://github.com/rishirajrateria/EraOfMarketingTaskManager.git
cd EraOfMarketingTaskManager
docker compose up --build
```

Open http://localhost:3000. The login page shows **Try a demo role** with Admin, Team Leader, Executive and HR
buttons (sample data is seeded on first boot). Tap one to open that role's dashboard; use the small **Demo · switch**
chip at the top of any screen (or `/login?switch=1`) to jump to another role. Google integrations run in mock mode, so
Drive/Meet/Chat links are placeholders.

Demo sign-in only exists while `DEMO_LOGIN=true`, and the compose file now defaults every demo / mock switch to
**off** and requires `AUTH_SECRET`, `VAULT_ENCRYPTION_KEY` and `CRON_SECRET` (no public defaults). For a local try-out put this in
`.env` next to `docker-compose.yml`:

```bash
AUTH_SECRET=$(openssl rand -base64 32)  VAULT_ENCRYPTION_KEY=$(openssl rand -base64 32)  CRON_SECRET=$(openssl rand -hex 24)
GOOGLE_MOCK=true  DEMO_LOGIN=true  SEED_DEMO=true  ALLOW_DEMO_IN_PRODUCTION=true   # the container runs NODE_ENV=production
```

Never set these on a public deployment.

Without Docker: `npm install`, create a Postgres database, copy `.env.example` to `.env` and set `DATABASE_URL`,
`DEMO_LOGIN=true`, `GOOGLE_MOCK=true`, then `npx prisma migrate deploy && npm run db:seed && npm run dev`.

## Quick start (local)

```bash
cp .env.example .env            # fill AUTH_GOOGLE_ID/SECRET, AUTH_SECRET, DATABASE_URL
npm install
npx prisma migrate dev          # creates the schema
npm run db:seed                 # demo teams/users/clients/tasks in every colour state
npm run dev                     # http://localhost:3000
```

`GOOGLE_MOCK=true` (default) makes every Google call return fake ids so the whole app works without a service
account. Set it to `false` once the service account below is configured.

Sign in with a Google account whose email exists in the `User` table (the seed creates `admin@<domain>`,
`rishi@<domain>` …) or that is listed in `BOOTSTRAP_ADMIN_EMAILS`. Unknown emails are rejected (SPEC §4).

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | Next.js |
| `npm run typecheck` · `npm run lint` · `npm test` | tsc, eslint, vitest (unit + DB integration tests) |
| `npm run db:migrate` · `npm run db:deploy` · `npm run db:seed` | Prisma migrations / seed |
| `npm run jobs` | Standalone job runner (same jobs as `/api/jobs/*`) |

Tests need a Postgres at `TEST_DATABASE_URL` (default `postgresql://postgres:postgres@127.0.0.1:5432/taskmanager_test`);
apply migrations to it once with `DATABASE_URL=<test url> npx prisma migrate deploy`.

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection (Neon/Supabase/local) |
| `AUTH_SECRET`, `AUTH_URL` | NextAuth secret (`openssl rand -base64 32`) and public URL |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | OAuth client (Web application) |
| `GOOGLE_WORKSPACE_DOMAIN` | Domain(s) that may sign in and be invited, comma-separated, staff domain first (e.g. `theeraofmarketing.com,eraofmarketing.com`). `hd` is sent only when one domain is listed. `GOOGLE_WORKSPACE_DOMAINS` is an alias (ADR 0018) |
| `BOOTSTRAP_ADMIN_EMAILS` | Comma-separated emails auto-created as ADMIN on first sign-in (allowed even outside the domains) |
| `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` | Service-account JSON key, base64 (`base64 -w0 key.json`) |
| `GOOGLE_IMPERSONATE_USER` | Workspace user the service account acts as (owner of folders/events/spaces; sender of non-finance mail) |
| `GOOGLE_FINANCE_SENDER` | Mailbox finance mail is sent from: invoices, proformas, credit notes, cancellations, receipts, payment reminders, GST pack (e.g. `finance@theeraofmarketing.com`). Must be in the delegated Workspace. Falls back to `GOOGLE_IMPERSONATE_USER` (ADR 0018) |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Optional parent folder for `Clients/` and `Finance/` |
| `GOOGLE_FINANCE_SHEET_ID`, `GOOGLE_EXPENSES_SHEET_ID` | Sheets for two-way finance sync (auto-created if empty; copy the id back) |
| `GOOGLE_MOCK` | `true` = no Google calls (dev/CI). **Must be exactly `false` in production** or the server refuses to start |
| `AUTH_TRUST_HOST` | `true` behind a proxy such as Render so Auth.js trusts the forwarded host (set in `render.yaml`) |
| `ALLOW_DEMO_IN_PRODUCTION` | **UNSAFE** escape hatch for staging / demo deploys only: allows mock Google, demo sign-in, the demo seed and a non-32-byte vault key under `NODE_ENV=production`. Never on a real deployment |
| `CRON_SECRET` | Bearer token for `/api/jobs/*` (external schedulers) |
| `JOBS_INLINE` | `true` (default) = run jobs on an interval inside the Node process |
| `VAULT_ENCRYPTION_KEY` | 32-byte base64 key for client-vault passwords (AES-256-GCM): `openssl rand -base64 32`. Keep an offline copy: passwords are unrecoverable without it |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push (`npx web-push generate-vapid-keys`) |
| `COMPANY_TIMEZONE` | Default `Asia/Kolkata` (also editable in Settings) |
| `DEMO_LOGIN` | `true` shows the demo role chooser on the login page (local try-outs only; ignored in production unless `ALLOW_DEMO_IN_PRODUCTION=true`) |
| `SEED_DEMO` | `true` runs the demo seed on container boot (default off; the seed refuses to run in production without `ALLOW_DEMO_IN_PRODUCTION=true` and never overwrites existing company settings) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | WhatsApp sends on invoice approval (mock when unset) |
| `PUBLIC_BASE_URL` | Public URL used in WhatsApp PDF links (defaults to `AUTH_URL`) |
| `STT_PROVIDER_URL` | Optional server speech-to-text fallback endpoint (`STT_PROVIDER_KEY` is its optional bearer key) |

### Lines to add to `.env.example`

`.env.example` could not be edited by the tooling that made this change (write blocked by permissions), so add these
lines to it by hand. Also change the `GOOGLE_MOCK` comment to say it must be `false` in production, and the `CRON_SECRET` /
`JOBS_INLINE` comments to drop the Vercel wording.

```bash
AUTH_TRUST_HOST="true"          # behind a proxy such as Render
GOOGLE_FINANCE_SENDER=""        # finance mailbox; falls back to GOOGLE_IMPERSONATE_USER
STT_PROVIDER_URL=""             # optional speech-to-text fallback (STT_PROVIDER_KEY optional)
DEMO_LOGIN="false"
SEED_DEMO="false"
ALLOW_DEMO_IN_PRODUCTION="false" # UNSAFE hatch, staging / demo only
```

## Google Cloud setup

1. **Project & APIs** — create a project and enable: Google Drive API, Google Calendar API, Google Chat API,
   Gmail API, Google Sheets API, People API, Google Meet REST API (ADR 0015).
2. **OAuth consent screen** — type *Internal* (Workspace). Scopes: `openid email profile`,
   `…/auth/calendar`, `…/auth/drive`, `…/auth/chat.spaces`, `…/auth/chat.messages`, `…/auth/gmail.send`,
   `…/auth/spreadsheets` (incremental consent is requested at sign-in).
3. **OAuth client** — *Web application*; authorised redirect URI `https://<host>/api/auth/callback/google`
   (and `http://localhost:3000/api/auth/callback/google`). Put id/secret in `AUTH_GOOGLE_ID/SECRET`.
4. **Service account** — create one, download a JSON key → `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64`. Enable
   *Domain-wide delegation* on it and note the client id.
5. **Admin console → Security → API controls → Domain-wide delegation** — add the client id with scopes:
   ```
   https://www.googleapis.com/auth/drive,
   https://www.googleapis.com/auth/calendar,
   https://www.googleapis.com/auth/chat.spaces,
   https://www.googleapis.com/auth/chat.messages,
   https://www.googleapis.com/auth/chat.memberships,
   https://www.googleapis.com/auth/gmail.send,
   https://www.googleapis.com/auth/spreadsheets,
   https://www.googleapis.com/auth/meetings.space.created,
   https://www.googleapis.com/auth/meetings.space.settings,
   https://www.googleapis.com/auth/meetings.space.readonly
   ```
   The three `meetings.space.*` scopes (ADR 0015) open every task's Meet link to anyone with the link, switch on
   Gemini "Take notes for me" and file the notes into the task's Drive folder. Without them tasks still work; the job
   results show a Meet warning. Gemini notes also need a Workspace edition that includes Gemini in Meet, and the
   impersonated user (`GOOGLE_IMPERSONATE_USER`, the organiser of every task event) must be licensed for it.
6. **Google Chat app** — in the Chat API configuration page, configure the app (name, avatar), *Enable interactive
   features* off, visibility: your Workspace domain. Spaces are created via `spaces.setup` by the impersonated user.
7. Set `GOOGLE_IMPERSONATE_USER` to a real Workspace user (e.g. `ops@company.com`) and `GOOGLE_MOCK=false`.
8. **Finance mailbox and a second domain (ADR 0018)** — `GOOGLE_FINANCE_SENDER` must be a real mailbox (user, not a
   group or alias) in the same Workspace as the service account's delegation; the `gmail.send` scope above already
   covers it. If the admin's domain is a separate Google Workspace, set the OAuth consent screen to *External* (an
   *Internal* app only admits the project's own Workspace) and list both domains in `GOOGLE_WORKSPACE_DOMAIN`. That
   admin is then an external user for Google calls: invites, Calendar attendance and email work; their own calendar is
   not read for leave sync, and Chat / Drive sharing with them depends on the Workspace's external-sharing settings.

   **Era of Marketing's setup (confirmed 11 Oct 2026): two separate Workspaces.** `theeraofmarketing.com` (staff,
   finance) is the company Workspace: create the Cloud project, service account and domain-wide delegation there.
   `eraofmarketing.com` (the admin, `contact@eraofmarketing.com`) is a different Workspace and is treated as external.
   - `GOOGLE_WORKSPACE_DOMAIN=theeraofmarketing.com,eraofmarketing.com` (staff domain first).
   - `GOOGLE_IMPERSONATE_USER` and `GOOGLE_FINANCE_SENDER` must both be `@theeraofmarketing.com` users (e.g.
     `ops@…` and `finance@…`) — never `contact@eraofmarketing.com`, which delegation cannot act as.
   - `BOOTSTRAP_ADMIN_EMAILS=contact@eraofmarketing.com`.
   - OAuth consent screen: *External*, published.
   - theeraofmarketing.com Admin console → Drive and Docs → Sharing settings: allow sharing outside the organisation
     (the admin and every client — client kits and the client tracking link's Drive folder — are external).
   - Google Chat → External chat settings: on in **both** Workspaces, or the admin can't join task Chat spaces.
   - The admin's leave is raised in the app; their Google Calendar isn't read for leave sync.

## Deployment

Target: **Render, paid plan** (always on, no spin-down) with **managed Postgres**. The app needs a single long-running
Node process so that real-time updates (SSE) and the inline job scheduler work without Redis. A `Dockerfile`,
`docker-compose.yml` and a Render blueprint (`render.yaml`) are included.

1. **Render**: "New → Blueprint", point it at this repo. It creates a `starter` web service and a `basic-256mb`
   Postgres, wires `DATABASE_URL`, and generates `AUTH_SECRET`, `VAULT_ENCRYPTION_KEY` and `CRON_SECRET`. Fill in the
   `sync: false` variables: `AUTH_URL` and `PUBLIC_BASE_URL` (the site's https address), Google OAuth and service
   account, `GOOGLE_IMPERSONATE_USER`, `GOOGLE_FINANCE_SENDER`, VAPID keys, Twilio. `AUTH_TRUST_HOST=true` is preset.
   Migrations run on every boot (`prisma migrate deploy`). Roughly $15-25/month.
2. **Backups**: use the paid managed Postgres plan, which includes **daily backups and point-in-time restore**. Turn
   them on, and **test a restore** into a scratch database before you go live and again from time to time.
3. **Keep an offline copy of `VAULT_ENCRYPTION_KEY`** (password manager plus a printed or offline copy). Client
   passwords in the vault are encrypted with it and are **unrecoverable without it**; a database backup alone is not enough.
4. Any other Docker host: `docker compose up --build` with a `.env`, or run the image with `DATABASE_URL` and the env
   vars above; keep `JOBS_INLINE=true`.

### Production safety checks (ADR 0020)

When `NODE_ENV=production` (always true on Render and in the Docker image) the server checks its environment once at
boot and **refuses to start**, with a clear error listing every problem, if:

- `GOOGLE_MOCK` is not exactly `false` (unset counts as mock);
- `DEMO_LOGIN` is `true`;
- `AUTH_SECRET`, `VAULT_ENCRYPTION_KEY` or `CRON_SECRET` is missing or one of the public defaults that used to ship in
  `docker-compose.yml` / `.env.example`;
- `VAULT_ENCRYPTION_KEY` is not base64 of exactly 32 bytes (production never silently hashes it as development does).

Demo sign-in itself is also disabled in production, and `prisma/seed.ts` refuses to run there. The one escape hatch is
`ALLOW_DEMO_IN_PRODUCTION=true`, for **staging / demo deployments only**: it permits mock Google, demo sign-in, the demo
seed and a non-32-byte vault key. It never excuses missing or default secrets. Do not set it where real client data lives.

### Other schedulers

Every job is also an HTTP endpoint (`/api/jobs/<name>` with `Authorization: Bearer $CRON_SECRET`) for hosts without a
long-running process: `overdue`, `recurrence`, `invoices`, `vault-expiry`, `inventory`, `leave-sync`, `payables`,
`month-folders`, `meeting-notes`. `vercel.json` lists all nine, but Vercel is not a supported target: live updates need
the in-process SSE server.

## Operations notes

- **Failed Google jobs**: a Drive / Calendar / Meet / Chat step that fails after all retries notifies every Admin once and
  is listed under Settings → Google (Failed Google jobs) with **Retry** and **Dismiss**.
- **Client Drive sharing** (ADR 0020): a client can open only *Brand kit*, the *Credentials sheet*, *Reports* and
  *Final work*; the kit root and *Work* are never shared. Put approved deliverables in *Final work*. Kits made before
  this change need **Fix sharing** (Admin → Client kit → the client) once.

## Roles & where things live

| Role | Home | Notes |
|---|---|---|
| Admin | `/dashboard` + ☰ menu tray | all tasks, requests inbox `/requests`, back-office under `/admin/*` |
| Team Leader | `/dashboard` | own team, start/finish, raise doubt / requests |
| Executive | `/dashboard` | own tasks, raise review/time-change requests |
| HR | `/attendance`, `/requests/leave` | attendance, leave approvals |
| CA | (parked) | no login for now; Admin shares finance exports manually |

Source layout: `src/app` (routes), `src/components` (UI), `src/server/<module>` (server actions + queries),
`src/google` (Workspace wrappers + durable retry queue), `src/jobs` (schedulers), `src/lib` (auth, RBAC, time, …),
`prisma/` (schema, migrations, seed), `tests/` (vitest).
