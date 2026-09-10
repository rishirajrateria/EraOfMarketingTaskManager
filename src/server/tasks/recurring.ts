/** Recurring task generation (SPEC §13). Not a server action (called from jobs and approveFinish). */
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { bus } from "@/lib/events";
import { queueTaskCreation } from "@/google/task-integrations";
import { nextRunAt } from "@/server/tasks/recurrence";
import { findSlot } from "@/lib/working-time";
import { workingConfig } from "@/server/scheduling/slot";

export async function spawnNextOccurrence(taskId: string, actorId: string | null): Promise<string | null> {
  const t = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true, teams: true, tags: true, recurrenceRule: true } });
  if (!t?.recurrenceRule || t.recurrenceRule.stopped) return null;
  const rule = t.recurrenceRule;
  const settings = await getSettings();
  // `nextRunAt` IS the due time of the next occurrence (set at creation and advanced after each spawn).
  // A stale value (e.g. ON_COMPLETE approved late) is still honoured so no occurrence is skipped.
  const next = rule.nextRunAt ?? nextRunAt(rule, t.scheduledStart ?? new Date(), settings.timezone);
  if (!next) {
    await prisma.recurrenceRule.update({ where: { id: rule.id }, data: { stopped: true } });
    return null;
  }
  // Occurrences land exactly at the due time when it falls in working hours; otherwise the next working slot.
  const cfg = await workingConfig();
  const slot = findSlot(next, t.allocatedMinutes, cfg, []);
  const start = slot?.start ?? next;
  const end = slot?.end ?? new Date(start.getTime() + t.allocatedMinutes * 60000);
  // Idempotency: one occurrence per (rule, due time) — never re-create one that already exists.
  const existing = await prisma.task.findFirst({
    where: { recurrenceRuleId: rule.id, deletedAt: null, id: { not: t.id }, scheduledStart: { in: [next, start] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const reuse = !settings.recurrenceCreatesNewWorkspace;
  const occurrence = await prisma.task.create({
    data: {
      title: t.title,
      description: t.description,
      type: t.type,
      clientId: t.clientId,
      createdById: t.createdById,
      assignedById: t.assignedById,
      allocatedMinutes: t.allocatedMinutes,
      scheduledStart: start,
      scheduledEnd: end,
      important: t.important,
      priority: t.priority,
      selfAssigned: t.selfAssigned,
      protected: t.protected,
      parentTaskId: t.id,
      recurrenceRuleId: rule.id,
      status: "ASSIGNED",
      driveFolderId: reuse ? t.driveFolderId : null,
      driveFolderUrl: reuse ? t.driveFolderUrl : null,
      chatSpaceId: reuse ? t.chatSpaceId : null,
      chatSpaceUrl: reuse ? t.chatSpaceUrl : null,
      assignees: { create: t.assignees.map((a) => ({ userId: a.userId })) },
      teams: { create: t.teams.map((x) => ({ teamId: x.teamId })) },
      tags: { create: t.tags.map((x) => ({ workTypeId: x.workTypeId })) },
    },
  });
  await prisma.recurrenceRule.update({ where: { id: rule.id }, data: { nextRunAt: nextRunAt(rule, next, settings.timezone) } });
  await audit(actorId, "task.recur", "Task", occurrence.id, { from: t.id }, occurrence);
  await queueTaskCreation(occurrence.id, t.type);
  await notify({ userIds: t.assignees.map((a) => a.userId), kind: "TASK_ASSIGNED", title: `Recurring task: ${t.title}`, href: `/dashboard?task=${occurrence.id}`, taskId: occurrence.id, chat: false });
  bus.publish({ type: "task.changed", taskId: occurrence.id });
  return occurrence.id;
}

/** Admin stops an infinite recurrence. */
export async function stopRecurrence(ruleId: string) {
  await prisma.recurrenceRule.update({ where: { id: ruleId }, data: { stopped: true } });
}
