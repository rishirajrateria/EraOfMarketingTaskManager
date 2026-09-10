/** Runs every minute (SPEC §7): red overlay + notify assignees and superior; also drains the Google queue. */
import { prisma } from "@/lib/db";
import { bus } from "@/lib/events";
import { notify, taskStakeholderIds } from "@/lib/notify";
import { isOverdue, ACTIVE_STATUSES } from "@/server/tasks/state";
import { processPending } from "@/google/queue";

export async function run(now = new Date()): Promise<{ flagged: number; cleared: number; integrations: number }> {
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, status: { in: ACTIVE_STATUSES }, type: "WORK" },
    select: { id: true, title: true, status: true, scheduledStart: true, scheduledEnd: true, actualStart: true, overdue: true, overdueNotifiedAt: true, type: true },
  });
  let flagged = 0;
  let cleared = 0;
  for (const t of tasks) {
    const od = isOverdue(t, now);
    if (od && !t.overdue) {
      await prisma.task.update({ where: { id: t.id }, data: { overdue: true, overdueNotifiedAt: now } });
      await notify({ userIds: await taskStakeholderIds(t.id), kind: "TASK_OVERDUE", title: `Overdue: ${t.title}`, href: `/dashboard?task=${t.id}`, taskId: t.id });
      bus.publish({ type: "task.changed", taskId: t.id });
      flagged++;
    } else if (!od && t.overdue) {
      await prisma.task.update({ where: { id: t.id }, data: { overdue: false } });
      bus.publish({ type: "task.changed", taskId: t.id });
      cleared++;
    }
  }
  const integrations = await processPending();
  return { flagged, cleared, integrations };
}
