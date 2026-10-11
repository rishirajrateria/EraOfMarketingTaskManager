import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify, publishTaskChanged } from "@/lib/notify";
import { queueTaskPropagation } from "@/google/task-integrations";

/**
 * "Hold work" (ADR 0005): pause every open task of a client until an invoice is paid, then resume.
 * Mirrors the DB logic of pauseTask / resumeTask in src/server/tasks/lifecycle.ts without the per-task
 * RBAC (the caller has already checked ADMIN). No Google calls block the action.
 */
const OPEN: TaskStatus[] = ["ASSIGNED", "STARTED", "FINISH_REQUESTED"];
type Tx = Prisma.TransactionClient;

const taskSelect = { id: true, title: true, status: true, statusBeforePause: true, pausedAt: true, scheduledEnd: true, assignees: { select: { user: { select: { id: true, teamLeaderId: true } } } } } satisfies Prisma.TaskSelect;
type TaskRow = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

/** Assignees + their team leaders across a set of tasks. */
function stakeholders(tasks: TaskRow[]): string[] {
  const ids = new Set<string>();
  for (const t of tasks)
    for (const a of t.assignees) {
      ids.add(a.user.id);
      if (a.user.teamLeaderId) ids.add(a.user.teamLeaderId);
    }
  return Array.from(ids);
}

/** Pause one task the way `pauseTask` does: close open sessions, remember the status, stamp pausedAt. */
export async function pauseTaskRow(tx: Tx, t: Pick<TaskRow, "id" | "status">, now: Date): Promise<void> {
  await tx.taskSession.updateMany({ where: { taskId: t.id, endedAt: null }, data: { endedAt: now } });
  await tx.task.update({ where: { id: t.id }, data: { status: "PAUSED", statusBeforePause: t.status, pausedAt: now } });
}

/** Resume one task the way `resumeTask` does: restore the status, shift the end by the paused minutes, reopen a session. */
export async function resumeTaskRow(tx: Tx, t: Pick<TaskRow, "id" | "statusBeforePause" | "pausedAt" | "scheduledEnd">, now: Date): Promise<void> {
  const pausedMin = t.pausedAt ? Math.round((now.getTime() - t.pausedAt.getTime()) / 60000) : 0;
  const status = t.statusBeforePause ?? "ASSIGNED";
  const wasRunning = status === "STARTED" || status === "FINISH_REQUESTED";
  await tx.task.update({
    where: { id: t.id },
    data: {
      status,
      statusBeforePause: null,
      pausedAt: null,
      pausedTotalMinutes: { increment: pausedMin },
      scheduledEnd: t.scheduledEnd ? new Date(t.scheduledEnd.getTime() + pausedMin * 60000) : null,
    },
  });
  if (wasRunning) await tx.taskSession.create({ data: { taskId: t.id, startedAt: now } });
}

export type HoldResult = { paused: number; clientName: string; invoiceNumber: string };

export async function holdWorkCore(clientId: string, invoiceId: string, actorId: string | null): Promise<HoldResult> {
  const [client, inv] = await Promise.all([prisma.client.findUnique({ where: { id: clientId } }), prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, number: true, clientId: true, status: true } })]);
  if (!client) throw new Error("Client not found");
  if (!inv || inv.clientId !== clientId) throw new Error("Invoice does not belong to this client");
  if (inv.status === "PAID" || inv.status === "CANCELLED") throw new Error("Invoice is already settled");
  const now = new Date();
  const tasks = await prisma.task.findMany({ where: { clientId, deletedAt: null, status: { in: OPEN } }, select: taskSelect });
  await prisma.$transaction(async (tx) => {
    for (const t of tasks) await pauseTaskRow(tx, t, now);
    await tx.client.update({ where: { id: clientId }, data: { workOnHold: true, holdInvoiceId: inv.id, holdSince: now } });
    await audit(actorId, "client.hold_work", "Client", clientId, { workOnHold: client.workOnHold }, { workOnHold: true, invoice: inv.number, tasks: tasks.map((t) => t.id) }, tx);
  });
  await notify({
    userIds: stakeholders(tasks),
    kind: "WORK_ON_HOLD",
    title: `Work on hold for ${client.name} until invoice ${inv.number} is paid`,
    body: tasks.length ? `${tasks.length} task(s) paused` : "No open tasks right now; new work should wait",
    href: "/dashboard",
  });
  for (const t of tasks) void publishTaskChanged(t.id);
  return { paused: tasks.length, clientName: client.name, invoiceNumber: inv.number };
}

export type ResumeResult = { resumed: number; clientName: string };

export async function resumeWorkCore(clientId: string, actorId: string | null): Promise<ResumeResult> {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Client not found");
  if (!client.workOnHold) return { resumed: 0, clientName: client.name };
  const now = new Date();
  const tasks = await prisma.task.findMany({
    where: { clientId, deletedAt: null, status: "PAUSED", ...(client.holdSince ? { pausedAt: { gte: client.holdSince } } : {}) },
    select: taskSelect,
  });
  await prisma.$transaction(async (tx) => {
    for (const t of tasks) await resumeTaskRow(tx, t, now);
    await tx.client.update({ where: { id: clientId }, data: { workOnHold: false, holdInvoiceId: null, holdSince: null } });
    await audit(actorId, "client.resume_work", "Client", clientId, { workOnHold: true, holdInvoiceId: client.holdInvoiceId }, { workOnHold: false, tasks: tasks.map((t) => t.id) }, tx);
  });
  for (const t of tasks) {
    await queueTaskPropagation(t.id).catch(() => undefined);
    void publishTaskChanged(t.id);
  }
  await notify({
    userIds: stakeholders(tasks),
    kind: "WORK_RESUMED",
    title: `Work resumed for ${client.name}`,
    body: tasks.length ? `${tasks.length} task(s) resumed` : "",
    href: "/dashboard",
  });
  return { resumed: tasks.length, clientName: client.name };
}
