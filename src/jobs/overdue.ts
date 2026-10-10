/**
 * Runs every minute (SPEC §7, ADR 0017): keeps the overdue overlay flag in sync, sends the two one-time task updates
 * and drains the Google queue.
 * - TASK_NOT_STARTED once per task: a work task's scheduled start passed and nobody started it.
 * - TASK_PAST_END once per task: its scheduled end passed and it isn't finished (paused / done from their side /
 *   completed tasks are skipped).
 * Each is claimed with a conditional update on `notStartedNotifiedAt` / `pastEndNotifiedAt`, so overlapping runs never
 * send twice. Recipients: Admins, the Team Leader(s) and the assignees.
 */
import { prisma } from "@/lib/db";
import { notify, taskOverseerIds, publishTaskChanged } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { notStartedPhrase, pastEndPhrase } from "@/lib/notification-text";
import { taskDeepLink } from "@/lib/notification-kinds";
import { isOverdue, ACTIVE_STATUSES } from "@/server/tasks/state";
import { processPending } from "@/google/queue";

export type OverdueResult = { flagged: number; cleared: number; notStarted: number; pastEnd: number; integrations: number };

type Row = {
  id: string;
  status: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  actualStart: Date | null;
  notStartedNotifiedAt: Date | null;
  pastEndNotifiedAt: Date | null;
  assignees: { userId: string }[];
};

/** Pure: which one-time updates a task is due now. */
export function dueUpdates(t: Row, now: Date): { notStarted: boolean; pastEnd: boolean } {
  const waiting = t.status === "ASSIGNED" || t.status === "DRAFT";
  const unfinished = waiting || t.status === "STARTED";
  return {
    notStarted: !t.notStartedNotifiedAt && waiting && !t.actualStart && !!t.scheduledStart && t.scheduledStart < now,
    pastEnd: !t.pastEndNotifiedAt && unfinished && !!t.scheduledEnd && t.scheduledEnd < now,
  };
}

async function recipients(t: Row) {
  return Array.from(new Set([...(await taskOverseerIds(t.id)), ...t.assignees.map((a) => a.userId)]));
}

export async function run(now = new Date()): Promise<OverdueResult> {
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, status: { in: ACTIVE_STATUSES }, type: "WORK" },
    select: {
      id: true, title: true, status: true, scheduledStart: true, scheduledEnd: true, actualStart: true, overdue: true, type: true,
      notStartedNotifiedAt: true, pastEndNotifiedAt: true, assignees: { select: { userId: true } },
    },
  });
  const tz = (await getSettings()).timezone;
  let flagged = 0;
  let cleared = 0;
  let notStarted = 0;
  let pastEnd = 0;
  for (const t of tasks) {
    const od = isOverdue(t, now);
    if (od && !t.overdue) {
      await prisma.task.update({ where: { id: t.id }, data: { overdue: true, overdueNotifiedAt: now } });
      void publishTaskChanged(t.id);
      flagged++;
    } else if (!od && t.overdue) {
      await prisma.task.update({ where: { id: t.id }, data: { overdue: false } });
      void publishTaskChanged(t.id);
      cleared++;
    }
    const due = dueUpdates(t, now);
    if (due.notStarted) {
      const claim = await prisma.task.updateMany({ where: { id: t.id, notStartedNotifiedAt: null }, data: { notStartedNotifiedAt: now } });
      if (claim.count) {
        await notify({ userIds: await recipients(t), kind: "TASK_NOT_STARTED", title: notStartedPhrase(t.scheduledStart!, now, tz), href: taskDeepLink(t.id), taskId: t.id });
        notStarted++;
      }
    }
    if (due.pastEnd) {
      const claim = await prisma.task.updateMany({ where: { id: t.id, pastEndNotifiedAt: null }, data: { pastEndNotifiedAt: now } });
      if (claim.count) {
        await notify({ userIds: await recipients(t), kind: "TASK_PAST_END", title: pastEndPhrase(t.scheduledEnd!, now, tz), href: taskDeepLink(t.id), taskId: t.id });
        pastEnd++;
      }
    }
  }
  const integrations = await processPending();
  return { flagged, cleared, notStarted, pastEnd, integrations };
}
