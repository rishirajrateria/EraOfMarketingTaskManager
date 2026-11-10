import { publishTaskChanged } from "@/lib/notify";
/**
 * Durable queue of Google side-effects (SPEC §14): every call is idempotent (keyed) and retried with
 * backoff; a permanent failure is surfaced on the task row (`integrationError`) so Admin can retry.
 */
import type { IntegrationKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notifyJobFailed } from "@/google/job-failure";

const MAX_ATTEMPTS = 5;

export async function enqueue(
  kind: IntegrationKind,
  idempotencyKey: string,
  payload: Record<string, unknown>,
  opts: { taskId?: string; entityType?: string; entityId?: string } = {},
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return tx.integrationJob.upsert({
    where: { idempotencyKey },
    update: { status: "PENDING", nextAttemptAt: new Date(), lastError: null, attempts: 0, failureNotifiedAt: null, dismissedAt: null, payload: payload as Prisma.InputJsonValue },
    create: {
      kind,
      idempotencyKey,
      payload: payload as Prisma.InputJsonValue,
      taskId: opts.taskId,
      entityType: opts.entityType,
      entityId: opts.entityId,
    },
  });
}

export type Handler = (payload: Record<string, unknown>, job: { id: string; taskId: string | null }) => Promise<unknown>;

const handlers = new Map<IntegrationKind, Handler>();
export function registerHandler(kind: IntegrationKind, h: Handler) {
  handlers.set(kind, h);
}

/**
 * Runs due jobs. Handlers may queue follow-ups (CALENDAR_EVENT → MEET_CONFIG, ADR 0015), so a few passes are made
 * while the previous pass did work.
 */
export async function processPending(limit = 25): Promise<number> {
  const { registerTaskIntegrationHandlers } = await import("@/google/task-integrations");
  registerTaskIntegrationHandlers();
  let total = 0;
  for (let pass = 0; pass < 3; pass++) {
    const done = await processBatch(limit);
    total += done;
    if (!done) break;
  }
  return total;
}

async function processBatch(limit: number): Promise<number> {
  const jobs = await prisma.integrationJob.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  let done = 0;
  for (const job of jobs) {
    const h = handlers.get(job.kind);
    if (!h) continue;
    try {
      const result = await h((job.payload ?? {}) as Record<string, unknown>, { id: job.id, taskId: job.taskId });
      await prisma.integrationJob.update({
        where: { id: job.id },
        data: { status: "OK", result: (result ?? null) as Prisma.InputJsonValue, attempts: { increment: 1 } },
      });
      if (job.taskId) {
        await prisma.task.update({ where: { id: job.taskId }, data: { integrationError: null } }).catch(() => undefined);
        void publishTaskChanged(job.taskId);
      }
      done++;
    } catch (e) {
      const attempts = job.attempts + 1;
      const msg = e instanceof Error ? e.message : String(e);
      const failed = attempts >= MAX_ATTEMPTS;
      console.error(`[google-queue] ${job.kind} job ${job.id} attempt ${attempts}/${MAX_ATTEMPTS} failed${failed ? " (giving up)" : ""}:`, msg);
      await prisma.integrationJob.update({
        where: { id: job.id },
        data: {
          attempts,
          lastError: msg.slice(0, 1000),
          status: failed ? "FAILED" : "PENDING",
          nextAttemptAt: new Date(Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** attempts)),
        },
      });
      if (failed) {
        if (job.taskId) {
          await prisma.task.update({ where: { id: job.taskId }, data: { integrationError: `${job.kind}: ${msg.slice(0, 200)}` } }).catch(() => undefined);
          void publishTaskChanged(job.taskId);
        }
        await notifyJobFailed(job.id); // Admins hear once, with the task title and the failed step (ADR 0020)
      }
    }
  }
  return done;
}

/** Admin "retry" from the row badge. */
export async function retryFailedForTask(taskId: string) {
  await prisma.integrationJob.updateMany({
    where: { taskId, status: "FAILED" },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null, failureNotifiedAt: null, dismissedAt: null },
  });
  await prisma.task.update({ where: { id: taskId }, data: { integrationError: null } });
}

/** Admin "Retry" from the failed-jobs list: a task's jobs retry together (the existing action); a task-less job on its own. */
export async function retryFailedJob(jobId: string): Promise<void> {
  const job = await prisma.integrationJob.findUnique({ where: { id: jobId }, select: { id: true, taskId: true, status: true } });
  if (!job || job.status !== "FAILED") throw new Error("That job is no longer failed");
  if (job.taskId) return retryFailedForTask(job.taskId);
  await prisma.integrationJob.update({ where: { id: jobId }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null, failureNotifiedAt: null, dismissedAt: null } });
}

/** Admin "Dismiss": hide a failed job from the list; clears the task's error badge when nothing else is failing there. */
export async function dismissFailedJob(jobId: string): Promise<void> {
  const job = await prisma.integrationJob.findUnique({ where: { id: jobId }, select: { id: true, taskId: true, status: true } });
  if (!job || job.status !== "FAILED") throw new Error("That job is no longer failed");
  await prisma.integrationJob.update({ where: { id: jobId }, data: { dismissedAt: new Date() } });
  if (job.taskId && (await prisma.integrationJob.count({ where: { taskId: job.taskId, status: "FAILED", dismissedAt: null } })) === 0) {
    await prisma.task.update({ where: { id: job.taskId }, data: { integrationError: null } }).catch(() => undefined);
    void publishTaskChanged(job.taskId);
  }
}
