/**
 * Failed Google jobs, made visible to Admin (ADR 0020). When a queued Google side-effect runs out of attempts it is
 * marked FAILED; here Admins are notified once (per failure) with the task title and the step that failed, and the
 * Settings → Google integration list shows it with Retry / Dismiss. Logs are kept (console.error in the runner).
 */
import type { IntegrationKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { adminIds, notify } from "@/lib/notify";

/** Admin-facing name of the step a job kind performs. */
export const STEP_LABEL: Record<IntegrationKind, string> = {
  DRIVE_FOLDER: "Drive",
  DRIVE_SHARE: "Drive",
  CALENDAR_EVENT: "Calendar",
  CALENDAR_UPDATE: "Calendar",
  MEET_CONFIG: "Meet",
  CHAT_SPACE: "Chat",
  CHAT_MEMBERS: "Chat",
  GMAIL_SEND: "Email",
  SHEETS_SYNC: "Sheets",
};

export const stepLabel = (kind: IntegrationKind): string => STEP_LABEL[kind] ?? "Google";

export const FAILED_JOBS_HREF = "/admin/settings#google";

/**
 * Notifies Admins that this job failed for good. Idempotent: only the first call after a failure sends (the
 * `failureNotifiedAt` stamp is claimed atomically; re-queueing a job clears it). Never throws.
 */
export async function notifyJobFailed(jobId: string): Promise<boolean> {
  try {
    const claimed = await prisma.integrationJob.updateMany({ where: { id: jobId, status: "FAILED", failureNotifiedAt: null }, data: { failureNotifiedAt: new Date() } });
    if (claimed.count === 0) return false;
    const job = await prisma.integrationJob.findUnique({ where: { id: jobId }, include: { task: { select: { id: true, title: true } } } });
    if (!job) return false;
    const step = stepLabel(job.kind);
    await notify({
      userIds: await adminIds(),
      kind: "INTEGRATION_FAILED",
      title: `Google ${step} failed`,
      body: (job.task ? "" : `${job.entityType ?? job.kind} · `) + (job.lastError ?? "Unknown error").slice(0, 160),
      href: FAILED_JOBS_HREF,
      taskId: job.task?.id,
    });
    return true;
  } catch (e) {
    console.error("[google-queue] could not notify admins of failed job", jobId, e instanceof Error ? e.message : e);
    return false;
  }
}

export type FailedJobRow = { id: string; step: string; kind: IntegrationKind; taskId: string | null; taskTitle: string | null; error: string; attempts: number; failedAt: string };

/** Undismissed FAILED jobs, newest first. */
export async function listFailedJobs(limit = 100): Promise<FailedJobRow[]> {
  const jobs = await prisma.integrationJob.findMany({
    where: { status: "FAILED", dismissedAt: null },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { task: { select: { title: true } } },
  });
  return jobs.map((j) => ({ id: j.id, step: stepLabel(j.kind), kind: j.kind, taskId: j.taskId, taskTitle: j.task?.title ?? null, error: j.lastError ?? "", attempts: j.attempts, failedAt: j.updatedAt.toISOString() }));
}
