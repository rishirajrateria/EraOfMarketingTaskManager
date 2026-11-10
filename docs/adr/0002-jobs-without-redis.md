# ADR 0002 — Background jobs without Redis

Status: accepted · Date: 2026-09-10

## Context
SPEC §1 suggests Inngest or BullMQ + Redis for scheduled/recurring work (overdue detection every minute, recurring
tasks and invoices, vault expiry, nightly inventory) and for the Google side-effect pipeline.

## Decision
- Each job is a plain module in `src/jobs/*.ts` exporting `run()`; `src/jobs/registry.ts` lists them.
- Scheduling is pluggable: **Vercel Cron** hits `/api/jobs/<name>` (protected by `CRON_SECRET`), or the
  **inline scheduler** (`src/jobs/runner.ts`, started from `instrumentation.ts` when `JOBS_INLINE=true`) runs the same
  functions on intervals inside the Node process.
- Google side-effects are persisted as `IntegrationJob` rows (idempotency key, attempts, backoff, last error) and drained
  by `processPending()` from the overdue job and opportunistically after mutations. Permanent failures set
  `Task.integrationError`, rendered as a row badge with an Admin "retry".

## Consequences
- No Redis to operate; state lives in Postgres so retries survive restarts.
- Multi-instance hosts should point every instance's cron at one URL (Vercel Cron does) to avoid duplicate runs;
  the jobs themselves are idempotent so occasional overlap is harmless.
- If throughput ever requires it, `enqueue()`/`processPending()` can be re-implemented on BullMQ without touching callers.
