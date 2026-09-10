/**
 * Durable queue of Google side-effects (SPEC §14): every call is idempotent (keyed) and retried with
 * backoff; a permanent failure is surfaced on the task row (`integrationError`) so Admin can retry.
 */
import type { IntegrationKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bus } from "@/lib/events";

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
    update: { status: "PENDING", nextAttemptAt: new Date(), lastError: null, attempts: 0, payload: payload as Prisma.InputJsonValue },
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

export async function processPending(limit = 25): Promise<number> {
  const { registerTaskIntegrationHandlers } = await import("@/google/task-integrations");
  registerTaskIntegrationHandlers();
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
        bus.publish({ type: "task.changed", taskId: job.taskId });
      }
      done++;
    } catch (e) {
      const attempts = job.attempts + 1;
      const msg = e instanceof Error ? e.message : String(e);
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.integrationJob.update({
        where: { id: job.id },
        data: {
          attempts,
          lastError: msg.slice(0, 1000),
          status: failed ? "FAILED" : "PENDING",
          nextAttemptAt: new Date(Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** attempts)),
        },
      });
      if (failed && job.taskId) {
        await prisma.task.update({ where: { id: job.taskId }, data: { integrationError: `${job.kind}: ${msg.slice(0, 200)}` } }).catch(() => undefined);
        bus.publish({ type: "task.changed", taskId: job.taskId });
      }
    }
  }
  return done;
}

/** Admin "retry" from the row badge. */
export async function retryFailedForTask(taskId: string) {
  await prisma.integrationJob.updateMany({
    where: { taskId, status: "FAILED" },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
  await prisma.task.update({ where: { id: taskId }, data: { integrationError: null } });
}
