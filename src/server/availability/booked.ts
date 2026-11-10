/**
 * Booked work per person per day (ADR 0019): open WORK tasks with time (meetings and deadline-only tasks book no hours,
 * ADR 0015/0016), spread across the working days the task occupies using the same per-person windows the slot finder
 * places into. Inventory, the add-task header, the HR tile and the slot finder's capacity check all read this.
 */
import { prisma } from "@/lib/db";
import { dateKey, parseDateKey } from "@/lib/time";
import { clipMinutes, type Interval } from "@/lib/working-time";
import { addKeyDays, type AvailabilityConfig, type PersonDay } from "@/server/availability/day-status";
import { loadAvailability, loadPeople, type Availability } from "@/server/availability/load";

/** Booked work: open work tasks with time (a deadline-only task books no hours; a meeting is busy time, not hours). */
export const BOOKED_TASK_WHERE = { deletedAt: null, type: "WORK" as const, deadlineOnly: false, status: { not: "COMPLETED" as const } };

export type BookedTask = { id: string; allocatedMinutes: number; scheduledStart: Date | null; scheduledEnd: Date | null };
export type BookedRow = { taskId: string; userId: string; day: string; minutes: number };

/** Minutes of `window` inside [start, end). */
const overlap = (window: Interval[], start: Date, end: Date) => clipMinutes(window, start, end);

/**
 * Splits a task's allocated minutes over the days it occupies, in proportion to the person's available working time
 * inside the task's [start, end), each day capped at its capacity. A single-day task (or one that sits entirely on non-working time) books its start
 * day — which is how an over-booked or off-day start shows up as "over by". Unscheduled tasks book `todayKey`.
 */
export function spreadMinutes(task: BookedTask, dayOf: (key: string) => PersonDay, tz: string, todayKey: string): Map<string, number> {
  const out = new Map<string, number>();
  const { scheduledStart: start, allocatedMinutes: total } = task;
  if (!start) return out.set(todayKey, total);
  const end = task.scheduledEnd && task.scheduledEnd > start ? task.scheduledEnd : new Date(start.getTime() + total * 60_000);
  const startKey = dateKey(start, tz);
  const endKey = dateKey(new Date(end.getTime() - 1), tz);
  if (endKey <= startKey) return out.set(startKey, total);
  const weights: [string, number][] = [];
  // A day carries at most its capacity (the slot finder never books more), so a short-capacity day is not over-weighted.
  for (let k = startKey, i = 0; k <= endKey && i < 400; k = addKeyDays(k, 1), i++) {
    const d = dayOf(k);
    weights.push([k, Math.min(overlap(d.window, start, end), d.capacityMinutes)]);
  }
  const sum = weights.reduce((s, [, w]) => s + w, 0);
  if (sum <= 0) return out.set(startKey, total);
  let left = total;
  const live = weights.filter(([, w]) => w > 0);
  live.forEach(([k, w], i) => {
    const part = i === live.length - 1 ? left : Math.min(left, Math.floor((total * w) / sum));
    left -= part;
    out.set(k, part);
  });
  return out;
}

export type World = { availability: Availability; booked: BookedRow[]; people: string[] };

/**
 * One load for everyone in `userIds` over [fromKey, toKey]: availability (over the range widened to the tasks that
 * reach into it) and the booked rows inside the range. `excludeTaskId`: a task being moved books nothing.
 */
export async function loadWorld(
  userIds: string[],
  fromKey: string,
  toKey: string,
  cfg: AvailabilityConfig,
  opts: { now?: Date; excludeTaskId?: string } = {},
): Promise<World> {
  const tz = cfg.timezone;
  const todayKey = dateKey(opts.now ?? new Date(), tz);
  const start = parseDateKey(fromKey, tz);
  const end = parseDateKey(addKeyDays(toKey, 1), tz);
  const people = await loadPeople(userIds);
  const ids = people.map((p) => p.id);
  const tasks = ids.length
    ? await prisma.task.findMany({
        where: {
          ...BOOKED_TASK_WHERE,
          ...(opts.excludeTaskId ? { id: { not: opts.excludeTaskId } } : {}),
          assignees: { some: { userId: { in: ids } } },
          OR: [
            { scheduledStart: null },
            { scheduledStart: { lt: end }, scheduledEnd: { gt: start } },
            { scheduledStart: { gte: start, lt: end }, scheduledEnd: null },
          ],
        },
        select: { id: true, allocatedMinutes: true, scheduledStart: true, scheduledEnd: true, assignees: { select: { userId: true } } },
      })
    : [];
  let lo = fromKey;
  let hi = toKey;
  for (const t of tasks) {
    if (!t.scheduledStart) continue;
    const e = t.scheduledEnd && t.scheduledEnd > t.scheduledStart ? t.scheduledEnd : new Date(t.scheduledStart.getTime() + t.allocatedMinutes * 60_000);
    const a = dateKey(t.scheduledStart, tz);
    const b = dateKey(new Date(e.getTime() - 1), tz);
    if (a < lo) lo = a;
    if (b > hi) hi = b;
  }
  const availability = await loadAvailability(people, lo, hi, cfg);
  const booked: BookedRow[] = [];
  const idSet = new Set(ids);
  for (const t of tasks) {
    for (const a of t.assignees) {
      if (!idSet.has(a.userId)) continue;
      for (const [day, minutes] of spreadMinutes(t, (k) => availability.day(a.userId, k), tz, todayKey)) {
        if (day >= fromKey && day <= toKey && minutes > 0) booked.push({ taskId: t.id, userId: a.userId, day, minutes });
      }
    }
  }
  return { availability, booked, people: ids };
}
