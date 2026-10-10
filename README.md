# EraOfMarketing Task Manager

Mobile-first task manager for a marketing agency: Google-Tasks-style list with hierarchy (Admin → Team Leader →
Executive), time-based scheduling, sellable-hours inventory, deep Google Workspace automation (Drive folder, Calendar +
Meet, Chat space per task) and an Admin back-office (client vault, expenses, invoices, finance sheet, attendance,
inventory). Product spec: [`docs/SPEC.md`](docs/SPEC.md). Architecture decisions: [`docs/adr/`](docs/adr/).

## Stack

Next.js 15 (App Router, Server Actions) · TypeScript · Tailwind v4 · Prisma + PostgreSQL · NextAuth v5 (Google) ·
googleapis (service account with domain-wide delegation) · pdfkit · web-push · vitest. Installable PWA with offline
shell and push notifications. Jobs run either in-process (`JOBS_INLINE=true`) or via Vercel Cron (`vercel.json`).

## Get a public test link in 10 minutes (Render, free tier)

1. Merge the pull request into your default branch (the Deploy button reads `render.yaml` from it).
2. Click **[Deploy to Render](https://render.com/deploy?repo=https://github.com/rishirajrateria/EraOfMarketingTaskManager)**,
   sign in to Render (free), and accept the blueprint. Leave the optional Google/Twilio fields blank for now.
3. In 5–8 minutes the service is live at `https://eom-task-manager-xxxx.onrender.com`. Open it on your phone: the login
   page shows **Try a demo role** (Admin / Team Leader / Executive / HR) with sample data. Google integrations are mocked.
4. When you are ready for real use, set `DEMO_LOGIN=false`, `SEED_DEMO=false`, `GOOGLE_MOCK=false` in the Render
   dashboard, fill in the Google and Twilio variables, and redeploy. Free-tier services sleep after 15 minutes idle
   and the free database expires after 30 days, so upgrade both before going live.

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

Demo sign-in only exists while `DEMO_LOGIN=true`; the compose file turns it on for local use. Never set it on a
public deployment.

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
| `GOOGLE_MOCK` | `true` = no Google calls (dev/CI) |
| `CRON_SECRET` | Bearer token for `/api/jobs/*` (Vercel Cron sends it automatically) |
| `JOBS_INLINE` | `true` = run jobs on an interval inside the Node process; `false` on Vercel |
| `VAULT_ENCRYPTION_KEY` | 32-byte base64 key for client-vault passwords (AES-256-GCM) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push (`npx web-push generate-vapid-keys`) |
| `COMPANY_TIMEZONE` | Default `Asia/Kolkata` (also editable in Settings) |
| `DEMO_LOGIN` | `true` shows the demo role chooser on the login page (local try-outs only) |
| `SEED_DEMO` | `true` runs the demo seed on container boot (docker-compose default) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | WhatsApp sends on invoice approval (mock when unset) |
| `PUBLIC_BASE_URL` | Public URL used in WhatsApp PDF links (defaults to `AUTH_URL`) |
| `STT_PROVIDER_URL` | Optional server speech-to-text fallback endpoint |

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

## Deployment

### Recommended: one always-on container + managed Postgres (Render, Railway, Fly, or any Docker host)

The app needs a single long-running Node process so that real-time updates (SSE) and the inline job scheduler work
without Redis. A `Dockerfile`, `docker-compose.yml` and a Render blueprint (`render.yaml`) are included.

- **Render**: "New → Blueprint", point it at this repo; it creates the web service and a Postgres database, wires
  `DATABASE_URL`, and generates `AUTH_SECRET`, `VAULT_ENCRYPTION_KEY` and `CRON_SECRET`. Fill in the remaining env
  vars (Google OAuth, service account, VAPID keys, `AUTH_URL`). Migrations run on every boot (`prisma migrate deploy`).
  Roughly $15–25/month for the starter web service plus the basic database.
- **Any Docker host**: `docker compose up --build` (uses `.env`), or build the image and run it with `DATABASE_URL`
  and the env vars above; keep `JOBS_INLINE=true`.

### Alternative: Vercel + Neon/Supabase

- Set `JOBS_INLINE=false` and keep `vercel.json` crons (overdue every minute, recurrence, invoices, vault-expiry,
  inventory nightly, leave-sync every 30 minutes). Vercel sends `Authorization: Bearer $CRON_SECRET`.
- Build command `npm run build` (runs `prisma generate`), then `npx prisma migrate deploy` as a release step.
- Live updates rely on in-process SSE; on Vercel's serverless runtime they degrade to refresh-on-focus/pull-to-refresh,
  so prefer the container deployment if instant multi-user updates matter.

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
