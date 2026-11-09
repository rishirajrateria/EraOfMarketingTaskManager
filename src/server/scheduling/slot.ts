/**
 * Next-available-slot algorithm (SPEC §9.2) and shift-tasks-on-leave (SPEC §9.3).
 * Availability comes from `personDayStatus` (ADR 0019), the same source as inventory and the Day view.
 */
import { addDays } from "date-fns";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, parseDateKey } from "@/lib/time";
import type { Interval } from "@/lib/working-time";
import { freeBusy } from "@/google/calendar";
import { notify, publishTaskChanged } from "@/lib/notify";
import { whenPhrase } from "@/lib/notification-text";
import { taskDeepLink } from "@/lib/notification-kinds";
import { audit } from "@/lib/audit";
import { ACTIVE_STATUSES } from "@/server/tasks/state";
import { addKeyDays, type AvailabilityConfig } from "@/server/availability/day-status";
import { loadWorld, type World } from "@/server/availability/booked";
import { APPROVED_LEAVE_STATUSES, leaveKeys } from "@/server/availability/load";
import { fromDbDate, toDbDate } from "@/server/inventory/compute";
import { findAvailableSlot, slotDays } from "@/server/scheduling/finder";

/**
 * The company's working-time config. Holidays are `@db.Date` columns: read with `fromDbDate` (the same conversion
 * inventory uses), never `dateKey(h, tz)`, which shifts the day in zones west of UTC.
 */
export async function workingConfig(): Promise<AvailabilityConfig> {
  const s = await getSettings();
  return {
    timezone: s.timezone,
    workStartMinutes: s.workStartMinutes,
    workEndMinutes: s.workEndMinutes,
    lunchStartMinutes: s.lunchStartMinutes,
    lunchEndMinutes: s.lunchEndMinutes,
    workingDays: s.workingDays,
    holidays: s.holidays.map(fromDbDate),
    halfDayMinutes: s.halfDayMinutes,
  };
}

/** Days the user is on approved leave within [from, to], as yyyy-MM-dd keys (whole leaves, `fromDbDate` keys). */
export async function leaveDayKeys(userId: string, from: Date, to: Date, tz: string): Promise<Set<string>> {
  const leaves = await prisma.leave.findMany({
    where: { userId, status: { in: [...APPROVED_LEAVE_STATUSES] }, from: { lte: toDbDate(dateKey(to, tz)) }, to: { gte: toDbDate(dateKey(from, tz)) } },
  });
  return new Set(leaves.flatMap((l) => leaveKeys(l)));
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
 * Meetings are busy time (they block a slot and show in the Day view) but book no hours (ADR 0015/0016).
 */
export async function busyFor(userId: string, from: Date, to: Date, opts: BusyOptions) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, role: true, teamLeaderId: true } });
  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      deadlineOnly: false, // a deadline blocks no time in anyone's day
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

/** Slots start on a whole minute: "now" carries seconds, which would leak into scheduledStart and recurrences. */
export const ceilToMinute = (d: Date) => new Date(Math.ceil(d.getTime() / 60_000) * 60_000);

export type BusyTimeline = { hard: Interval[]; soft: { id: string; start: Date; end: Date }[]; world: World };

/**
 * Everyone's busy blocks (hard + soft) plus their availability and booked work over [from, to]: a slot must suit all
 * of them.
 */
export async function collectBusy(assigneeIds: string[], from: Date, to: Date, opts: BusyOptions, cfg: AvailabilityConfig): Promise<BusyTimeline> {
  const hard: Interval[] = [];
  const soft: BusyTimeline["soft"] = [];
  for (const id of assigneeIds) {
    const b = await busyFor(id, from, to, opts);
    hard.push(...b.hard);
    soft.push(...b.soft);
  }
  const tz = cfg.timezone;
  const world = await loadWorld(assigneeIds, dateKey(from, tz), dateKey(to, tz), cfg, { excludeTaskId: opts.excludeTaskId });
  return { hard, soft, world };
}

/**
 * Propose the next available slot for `minutes` of work for all assignees (intersection: one slot where every
 * assignee is available and free, within each one's capacity). Self-assigned soft blocks of subordinates may be
 * overlapped by a superior.
 */
export async function proposeSlot(
  assigneeIds: string[],
  minutes: number,
  /** `allowSplit` (default true): false = one contiguous gap of the full length (see `findAvailableSlot`). */
  opts: BusyOptions & { from?: Date; horizonDays?: number; allowSplit?: boolean },
): Promise<SlotProposal | null> {
  const cfg = await workingConfig();
  const from = ceilToMinute(opts.from ?? new Date());
  const horizon = addDays(from, opts.horizonDays ?? 60);
  const { hard, soft, world } = await collectBusy(assigneeIds, from, horizon, opts, cfg);
  // First try honouring soft blocks too; if nothing fits within the horizon, overlap soft blocks.
  const findOpts = { maxDays: opts.horizonDays ?? 60, allowSplit: opts.allowSplit };
  const strict = findAvailableSlot(from, minutes, cfg, [...hard, ...soft], slotDays(world, assigneeIds), findOpts);
  if (strict) return { ...strict, displaced: [] };
  const freed = slotDays(world, assigneeIds, new Set(soft.map((x) => x.id))); // displaced tasks give their hours back
  const loose = findAvailableSlot(from, minutes, cfg, hard, freed, findOpts);
  if (!loose) return null;
  const displaced = soft.filter((x) => x.start < loose.end && x.end > loose.start).map((x) => x.id);
  return { ...loose, displaced };
}

/** Re-schedule displaced soft-blocked tasks to their owners' next slot and notify (SPEC §9.2 step 3). */
export async function shiftDisplacedTasks(taskIds: string[], actorId: string) {
  for (const id of taskIds) await shiftTaskToNextSlot(id, actorId, "Your self-assigned task was moved to make room for a task assigned by your superior.");
}

/** Why a task is never moved automatically: it is under way, a meeting, or fixed. */
export type UnmovableReason = "started" | "meeting" | "protected";

export function unmovableReason(t: { status: string; type: string; protected: boolean }): UnmovableReason | null {
  if (t.type === "MEETING") return "meeting";
  if (t.status === "STARTED") return "started";
  if (t.protected) return "protected";
  return null;
}

/**
 * Moves one task to the next slot. Never touches started tasks, meetings, protected or deadline-only ones.
 * `notBefore`: search from there (default now); if nothing is found from there, from now as a last resort.
 */
export async function shiftTaskToNextSlot(taskId: string, actorId: string, reason: string, opts: { notBefore?: Date } = {}) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { assignees: { select: { userId: true } } },
  });
  if (!task || task.deletedAt || task.status === "COMPLETED") return null;
  if (unmovableReason(task)) return null; // fixed tasks (SPEC §2), started work and meetings are moved by their owners
  if (task.deadlineOnly) return null; // a deadline has no slot to move
  const ids = task.assignees.map((a) => a.userId);
  const search = (from: Date) => proposeSlot(ids, task.allocatedMinutes, { requesterRole: "ADMIN", requesterId: actorId, excludeTaskId: task.id, from });
  const now = new Date();
  const slot = (await search(opts.notBefore && opts.notBefore > now ? opts.notBefore : now)) ?? (opts.notBefore ? await search(now) : null);
  if (!slot) return null;
  const before = { scheduledStart: task.scheduledStart, scheduledEnd: task.scheduledEnd };
  await prisma.task.update({ where: { id: task.id }, data: { scheduledStart: slot.start, scheduledEnd: slot.end, overdue: false } });
  await audit(actorId, "task.shift", "Task", task.id, before, { scheduledStart: slot.start, scheduledEnd: slot.end });
  const { queueTaskPropagation } = await import("@/google/task-integrations");
  await queueTaskPropagation(task.id);
  const leaders = await prisma.user.findMany({ where: { id: { in: ids } }, select: { teamLeaderId: true } });
  await notify({
    userIds: [...ids, ...leaders.map((l) => l.teamLeaderId).filter((x): x is string => !!x)],
    kind: "TASK_SHIFTED",
    title: `Moved to ${whenPhrase(slot.start, new Date(), (await getSettings()).timezone)}`,
    body: reason,
    href: taskDeepLink(task.id),
    taskId: task.id,
  });
  void publishTaskChanged(task.id);
  return slot;
}

export type AffectedTask = { id: string; title: string; start: Date | null; movable: boolean; why: UnmovableReason | null };

async function leaveWindow(leave: { from: Date; to: Date }) {
  const tz = (await getSettings()).timezone;
  return { from: parseDateKey(fromDbDate(leave.from), tz), to: parseDateKey(addKeyDays(fromDbDate(leave.to), 1), tz) };
}

/**
 * Open tasks of the leave's user that overlap the leave window (SPEC §9.3), each flagged `movable` or — started tasks,
 * meetings, protected ones — "move yourself". The window is read from the leave's `@db.Date` keys (`fromDbDate`).
 */
export async function tasksAffectedByLeave(leaveId: string): Promise<AffectedTask[]> {
  const leave = await prisma.leave.findUnique({ where: { id: leaveId } });
  if (!leave) return [];
  const { from, to } = await leaveWindow(leave);
  const rows = await prisma.task.findMany({
    where: {
      deletedAt: null,
      deadlineOnly: false,
      status: { in: ACTIVE_STATUSES },
      assignees: { some: { userId: leave.userId } },
      scheduledStart: { lt: to },
      scheduledEnd: { gt: from },
    },
    select: { id: true, title: true, status: true, type: true, protected: true, scheduledStart: true },
    orderBy: { scheduledStart: "asc" },
  });
  return rows.map((t) => {
    const why = unmovableReason(t);
    return { id: t.id, title: t.title, start: t.scheduledStart, movable: !why, why };
  });
}

/** `remaining`: still in the leave (started / meeting / protected, or no slot found). */
export type LeaveShiftResult = { shifted: number; remaining: number; manual: AffectedTask[] };

/**
 * One-tap "Shift all affected tasks to next available slot", in schedule order. Only movable tasks move, and only to
 * a slot after the leave starts and not before their original start. `tasksShiftedAt` is set only when nothing is left
 * in the leave; otherwise the leave keeps showing "needs shift" with the remaining count.
 */
export async function shiftTasksForLeave(leaveId: string, actorId: string): Promise<LeaveShiftResult> {
  const leave = await prisma.leave.findUnique({ where: { id: leaveId } });
  const affected = await tasksAffectedByLeave(leaveId);
  const leaveStart = leave ? (await leaveWindow(leave)).from : new Date();
  let shifted = 0;
  const manual: AffectedTask[] = [];
  for (const t of affected) {
    const notBefore = new Date(Math.max(leaveStart.getTime(), t.start?.getTime() ?? 0));
    const moved = t.movable ? await shiftTaskToNextSlot(t.id, actorId, "Rescheduled because of approved leave.", { notBefore }) : null;
    if (moved) shifted++;
    else manual.push(t);
  }
  if (affected.length && !manual.length) await prisma.leave.update({ where: { id: leaveId }, data: { tasksShiftedAt: new Date() } });
  return { shifted, remaining: manual.length, manual };
}
