# ADR 0001 — Architecture and code conventions

Status: accepted · Date: 2026-09-10

## Decisions

1. **Single Next.js 15 App Router codebase** (`src/app`). Server Actions carry all mutations; route handlers
   only for auth, SSE (`/api/events`), cron jobs (`/api/jobs/*`), file streaming and push subscription.
2. **Prisma + PostgreSQL** (`prisma/schema.prisma`). Soft deletes via `deletedAt`. Money as `Decimal`.
3. **Auth**: NextAuth v5 (`src/lib/auth.ts`), Google provider, database sessions. Users are pre-created by Admin;
   unknown emails are rejected at sign-in. `BOOTSTRAP_ADMIN_EMAILS` seeds the first Admin.
4. **RBAC**: `src/lib/rbac.ts` — `requireUser()`, `requireRole(...)`, `can.*` capability matrix. Every server action
   and page enforces it server-side. Never trust the client.
5. **Audit**: every state change calls `audit(actorId, action, entityType, entityId, before, after)`.
6. **Google APIs**: `src/google/*` wrappers; `GOOGLE_MOCK=true` returns deterministic fake ids so the app and tests
   run without credentials. Side effects go through the durable `IntegrationJob` queue (`src/google/queue.ts`).
7. **Jobs**: `src/jobs/*.ts` export `run()` functions. `/api/jobs/<name>` route handlers (protected by
   `CRON_SECRET`) invoke them from Vercel Cron; `JOBS_INLINE=true` runs them on an interval inside the Node process
   (`src/jobs/runner.ts`), which replaces a Redis/BullMQ dependency for single-instance hosts.
8. **Real-time**: in-process event bus (`src/lib/events.ts`) + SSE. Swap for Redis pub/sub when scaling out.
9. **Notifications**: `notify()` in `src/lib/notify.ts` writes in-app rows and fans out to push/Chat/email.
10. **Secrets**: vault passwords encrypted with AES-256-GCM (`src/lib/crypto.ts`); never logged.

## Code conventions (all contributors, human or agent)

- Files < 500 lines. Source in `src/`, tests in `tests/` (vitest, `npm test`), docs in `docs/`.
- Server actions live in `src/server/<module>/actions.ts` with `"use server"` at the top, validate input with `zod`,
  call `requireRole`/`requireUser`, return `ActionResult<T>` via `wrap()` from `src/lib/action-result.ts`,
  and call `revalidatePath()` for the pages they affect.
- Queries live in `src/server/<module>/queries.ts` (no `"use server"`).
- Pages are React Server Components under `src/app/(app)/...`; interactive parts are `"use client"` components
  under `src/components/<module>/`.
- UI: Tailwind v4, mobile-first, phone frame max 480px. Use `src/components/ui/*` primitives
  (`Pill`, `Sheet`, `ActionList`, `Field`, `inputCls`, `btnPrimary`, `useToast`, `useLongPress`).
- Times are stored in UTC; format with helpers in `src/lib/time.ts` using the company timezone
  (`getSettings().timezone`, default Asia/Kolkata).
- Tests: pure logic gets unit tests; DB-backed logic gets integration tests against `DATABASE_URL`
  (a local Postgres is available in dev) — see `tests/helpers/db.ts`.
