/**
 * In-process scheduler (JOBS_INLINE=true) — replaces BullMQ/Redis on single-instance hosts.
 * Started from instrumentation.ts inside Next, or standalone with `npm run jobs`.
 */
import { runJob, type JobName } from "@/jobs/registry";

const SCHEDULE: Record<JobName, number> = {
  overdue: 60_000,
  recurrence: 5 * 60_000,
  invoices: 10 * 60_000,
  "vault-expiry": 5 * 60_000,
  inventory: 24 * 60 * 60_000,
  "leave-sync": 30 * 60_000,
  payables: 60 * 60_000, // ADR 0009: next recurring bill + payment reminders (idempotent)
  "month-folders": 12 * 60 * 60_000, // ADR 0009: Finance/YYYY-MM in Drive (cached after the first run each month)
  "meeting-notes": 30 * 60_000, // ADR 0015: file Gemini meeting notes into each task's Drive "Meeting notes" folder
};

const g = globalThis as unknown as { __eomJobsStarted?: boolean };

export function startInlineJobs() {
  if (g.__eomJobsStarted) return;
  g.__eomJobsStarted = true;
  for (const [name, every] of Object.entries(SCHEDULE) as [JobName, number][]) {
    const tick = async () => {
      try {
        await runJob(name);
      } catch (e) {
        console.error(`[jobs] ${name} failed`, e);
      }
    };
    setTimeout(tick, 5_000);
    setInterval(tick, every).unref?.();
  }
  console.log("[jobs] inline scheduler started");
}

if (process.argv[1]?.endsWith("runner.ts")) {
  startInlineJobs();
}
