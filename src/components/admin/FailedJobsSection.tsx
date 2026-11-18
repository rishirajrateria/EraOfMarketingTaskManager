"use client";
import { useAdminAction } from "@/components/admin/AdminUi";
import { Section } from "@/components/admin/SettingsSections";
import { dismissGoogleJob, retryGoogleJob } from "@/server/admin/google-jobs-actions";
import type { FailedJobRow } from "@/google/job-failure";

/** Settings → Google integration: Google jobs that ran out of attempts, with Retry and Dismiss (ADR 0020). */
export function FailedJobsSection({ jobs }: { jobs: FailedJobRow[] }) {
  const { busy, run } = useAdminAction();
  const btn = "touch-target rounded-lg border border-hair bg-chip px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50";
  return (
    <Section id="failed-google-jobs" title={`Failed Google jobs${jobs.length ? ` (${jobs.length})` : ""}`}>
      {jobs.length === 0 ? <p className="text-xs text-gray-500">Nothing has failed. Drive, Calendar, Meet and Chat steps that run out of retries appear here.</p> : null}
      {jobs.map((j) => (
        <div key={j.id} className="rounded-xl border border-hair bg-chip px-3 py-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-gray-900">{j.taskTitle ?? "Not tied to a task"}</p>
              <p className="text-xs text-gray-600">
                {j.step} step failed · {j.attempts} attempts · {new Date(j.failedAt).toLocaleString()}
              </p>
            </div>
          </div>
          {j.error ? <p className="mt-1 break-words text-[11px] text-gray-500">{j.error}</p> : null}
          <div className="mt-2 flex gap-2">
            <button type="button" className={btn} disabled={busy} onClick={() => void run(retryGoogleJob(j.id), "Retrying")}>
              Retry
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => void run(dismissGoogleJob(j.id), "Dismissed")}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </Section>
  );
}
