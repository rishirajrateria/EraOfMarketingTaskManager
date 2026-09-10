/**
 * Next-available-slot algorithm (SPEC §9.2) and shift-tasks-on-leave (SPEC §9.3).
 */
import { addDays } from "date-fns";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, zonedStartOfDay } from "@/lib/time";
import { findSlot, type Interval, type WorkingConfig } from "@/lib/working-time";
import { freeBusy } from "@/google/calendar";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { bus } from "@/lib/events";
import { ACTIVE_STATUSES } from "@/server/tasks/state";

export async function workingConfig(): Promise<WorkingConfig> {
  const s = await getSettings();
  return {
    timezone: s.timezone,
    workStartMinutes: s.workStartMinutes,
    workEndMinutes: s.workEndMinutes,
    lunchStartMinutes: s.lunchStartMinutes,
    lunchEndMinutes: s.lunchEndMinutes,
    workingDays: s.workingDays,
    holidays: s.holidays.map((h) => dateKey(h, s.timezone)),
  };
}

/** Days the user is on approved leave within [from, to], as yyyy-MM-dd keys. */
export async function leaveDayKeys(userId: string, from: Date, to: Date, tz: string): Promise<Set<string>> {
  const leaves = await prisma.leave.findMany({
    where: { userId, status: { in: ["HR_APPROVED", "ADMIN_APPROVED"] }, from: { lte: to }, to: { gte: from } },
  });
  const keys = new Set<string>();
  for (const l of leaves) {
    let d = zonedStartOfDay(l.from, tz);
    const end = zonedStartOfDay(l.to, tz);
    while (d <= end) {
      keys.add(dateKey(d, tz));
      d = addDays(d, 1);
    }
  }
  return keys;
}

export type BusyOptions = {
  /** Requesting user's role/id decides whether other people's self-assigned tasks are hard or soft blocks. */
  requesterRole: "ADMIN" | "TEAM_LEADER" | "EXECUTIVE" | "HR" | "CA";
  requesterId: string;
  excludeTaskId?: string;
};

/**
 * Busy timeline for an assignee: DB tasks/meetings + Google Calendar busy blocks.
 * Returns { hard, soft } — soft blocks are self-assigned tasks of a TL/Executive that a superior may overlap.
 */
export async function busyFor(userId: string, from: Date, to: Date, opts: BusyOptions) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, role: true, teamLeaderId: true } });
  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: { in: ACTIVE_STATUSES },
      assignees: { some: { userId } },
      scheduledStart: { lt: to },
      scheduledEnd: { gt: from },
      ...(opts.excludeTaskId ? { id: { not: opts.excludeTaskId } } : {}),
    },
    select: { id: true, scheduledStart: true, scheduledEnd: true, selfAssigned: true, protected: true, createdById: true, assignedById: true },
  });
  const hard: Interval[] = [];
  const soft: { id: string; start: Date; end: Date }[] = [];
  const isSuperior =
    opts.requesterRole === "ADMIN" || (opts.requesterRole === "TEAM_LEADER" && user?.teamLeaderId === opts.requesterId);
  for (const t of tasks) {
    if (!t.scheduledStart || !t.scheduledEnd) continue;
    const iv = { start: t.scheduledStart, end: t.scheduledEnd };
    const ownerIsAdmin = user?.role === "ADMIN";
    const softBlock = t.selfAssigned && !t.protected && !ownerIsAdmin && isSuperior && t.createdById !== opts.requesterId;
    if (softBlock) soft.push({ id: t.id, ...iv });
    else hard.push(iv);
  }
  try {
    if (user?.email) hard.push(...(await freeBusy(user.email, from, to)));
  } catch {
    /* calendar optional */
  }
  return { hard, soft };
}

export type SlotProposal = { start: Date; end: Date; chunks: Interval[]; displaced: string[] };

/**
 * Propose the next available slot for `minutes` of work for all assignees (intersection: one slot where
 * every assignee is free). Self-assigned soft blocks of subordinates may be overlapped by a superior.
 */
export async function proposeSlot(
  assigneeIds: string[],
  minutes: number,
  opts: BusyOptions & { from?: Date; horizonDays?: number },
): Promise<SlotProposal | null> {
  const cfg = await workingConfig();
  const from = opts.from ?? new Date();
  const horizon = addDays(from, opts.horizonDays ?? 60);
  const hard: Interval[] = [];
  const soft: { id: string; start: Date; end: Date }[] = [];
  const off = new Set<string>();
  for (const id of assigneeIds) {
    const b = await busyFor(id, from, horizon, opts);
    hard.push(...b.hard);
    soft.push(...b.soft);
    for (const k of await leaveDayKeys(id, from, horizon, cfg.timezone)) off.add(k);
  }
  // First try honouring soft blocks too; if nothing fits within the horizon, overlap soft blocks.
  const strict = findSlot(from, minutes, cfg, [...hard, ...soft], { extraOff: off, maxDays: opts.horizonDays ?? 60 });
  if (strict) return { ...strict, displaced: [] };
  const loose = findSlot(from, minutes, cfg, hard, { extraOff: off, maxDays: opts.horizonDays ?? 60 });
  if (!loose) return null;
  const displaced = soft.filter((s) => s.start < loose.end && s.end > loose.start).map((s) => s.id);
  return { ...loose, displaced };
}

/** Re-schedule displaced soft-blocked tasks to their owners' next slot and notify (SPEC §9.2 step 3). */
export async function shiftDisplacedTasks(taskIds: string[], actorId: string) {
  for (const id of taskIds) await shiftTaskToNextSlot(id, actorId, "Your self-assigned task was moved to make room for a task assigned by your superior.");
}

export async function shiftTaskToNextSlot(taskId: string, actorId: string, reason: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { assignees: { select: { userId: true } } },
  });
  if (!task || task.deletedAt || task.status === "COMPLETED") return null;
  const slot = await proposeSlot(
    task.assignees.map((a) => a.userId),
    task.allocatedMinutes,
    { requesterRole: "ADMIN", requesterId: actorId, excludeTaskId: task.id, from: new Date() },
  );
  if (!slot) return null;
  const before = { scheduledStart: task.scheduledStart, scheduledEnd: task.scheduledEnd };
  await prisma.task.update({ where: { id: task.id }, data: { scheduledStart: slot.start, scheduledEnd: slot.end, overdue: false } });
  await audit(actorId, "task.shift", "Task", task.id, before, { scheduledStart: slot.start, scheduledEnd: slot.end });
  const { queueTaskPropagation } = await import("@/google/task-integrations");
  await queueTaskPropagation(task.id);
  const ids = task.assignees.map((a) => a.userId);
  const leaders = await prisma.user.findMany({ where: { id: { in: ids } }, select: { teamLeaderId: true } });
  await notify({
    userIds: [...ids, ...leaders.map((l) => l.teamLeaderId).filter((x): x is string => !!x)],
    kind: "TASK_SHIFTED",
    title: `Task rescheduled: ${task.title}`,
    body: reason,
    href: `/dashboard?task=${task.id}`,
    taskId: task.id,
  });
  bus.publish({ type: "task.changed", taskId: task.id });
  return slot;
}

/** Open tasks of the leave's user that overlap the leave window (SPEC §9.3). */
export async function tasksAffectedByLeave(leaveId: string): Promise<{ id: string; title: string }[]> {
  const leave = await prisma.leave.findUnique({ where: { id: leaveId } });
  if (!leave) return [];
  const s = await getSettings();
  const from = zonedStartOfDay(leave.from, s.timezone);
  const to = addDays(zonedStartOfDay(leave.to, s.timezone), 1);
  return prisma.task.findMany({
    where: {
      deletedAt: null,
      status: { in: ACTIVE_STATUSES },
      assignees: { some: { userId: leave.userId } },
      scheduledStart: { lt: to },
      scheduledEnd: { gt: from },
    },
    select: { id: true, title: true },
    orderBy: { scheduledStart: "asc" },
  });
}

/** One-tap "Shift all affected tasks to next available slot", in schedule order. */
export async function shiftTasksForLeave(leaveId: string, actorId: string): Promise<{ shifted: number }> {
  const affected = await tasksAffectedByLeave(leaveId);
  let shifted = 0;
  for (const t of affected) {
    const r = await shiftTaskToNextSlot(t.id, actorId, "Rescheduled because of approved leave.");
    if (r) shifted++;
  }
  if (affected.length) await prisma.leave.update({ where: { id: leaveId }, data: { tasksShiftedAt: new Date() } });
  return { shifted };
}
