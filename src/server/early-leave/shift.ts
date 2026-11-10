/**
 * "Shift all to next free slots" for an early leave (ADR 0022). The plan is a dry run of the same slot finder the leave
 * shift uses (`proposeSlot`, ADR 0019): each movable task searches from the end of the covered period (never earlier
 * than now), and every placement already planned is passed in as busy time and booked minutes so the next one lands
 * after it — exactly what applying them one by one does. Applying re-plans and saves those very slots through
 * `applyTaskMove` (TASK_SHIFTED to the assignees and their Team Leaders, never to the Admin who shifted).
 * Started, paused and finish-requested tasks, meetings and protected tasks are never moved: "Move yourself".
 */
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { first } from "@/lib/notification-text";
import type { Interval } from "@/lib/working-time";
import { addKeyDays, isDayOff } from "@/server/availability/day-status";
import type { BookedRow } from "@/server/availability/booked";
import { loadAvailability, loadPeople } from "@/server/availability/load";
import { deadlineInstant } from "@/server/tasks/deadline";
import { applyTaskMove, proposeSlot, workingConfig } from "@/server/scheduling/slot";
import { unmovableReason, type UnmovableReason } from "@/server/scheduling/unmovable";
import { coverPeriod, type EarlyRecord } from "@/server/early-leave/core";
import { flaggedTasks, toRecord, type FlaggedTask } from "@/server/early-leave/service";

export type ShiftWhy = UnmovableReason | "no-slot";
export type ShiftPlanItem = {
  taskId: string;
  title: string;
  deadlineOnly: boolean;
  from: { start: Date | null; end: Date | null };
  /** Null = stays where it is ("Move yourself"). */
  to: { start: Date; end: Date } | null;
  why: ShiftWhy | null;
};

/** Booked minutes per assignee per company day of a planned placement. */
function bookedRows(taskId: string, ids: string[], chunks: Interval[], tz: string): BookedRow[] {
  const perDay = new Map<string, number>();
  for (const c of chunks) {
    const k = dateKey(c.start, tz);
    perDay.set(k, (perDay.get(k) ?? 0) + Math.round((c.end.getTime() - c.start.getTime()) / 60_000));
  }
  return ids.flatMap((userId) => [...perDay].map(([day, minutes]) => ({ taskId, userId, day, minutes })));
}

/** First day from `fromKey` on which no assignee is off — a deadline's new "done by" day. */
async function nextDueDay(ids: string[], fromKey: string, tz: string, workEnd: number): Promise<Date | null> {
  const cfg = await workingConfig();
  const last = addKeyDays(fromKey, 60);
  const availability = await loadAvailability(await loadPeople(ids), fromKey, last, cfg);
  for (let k = fromKey; k <= last; k = addKeyDays(k, 1)) {
    if (ids.every((id) => !isDayOff(availability.day(id, k)))) return deadlineInstant(k, tz, workEnd);
  }
  return null;
}

export async function planFor(rec: EarlyRecord, tasks: FlaggedTask[], actorId: string, now = new Date()): Promise<ShiftPlanItem[]> {
  const s = await getSettings();
  const tz = s.timezone;
  const period = coverPeriod(rec, tz);
  const notBefore = period.to > now ? period.to : now;
  const hard = new Map<string, Interval[]>();
  const booked: BookedRow[] = [];
  const out: ShiftPlanItem[] = [];
  for (const t of tasks) {
    const base = { taskId: t.id, title: t.title, deadlineOnly: t.deadlineOnly, from: { start: t.scheduledStart, end: t.scheduledEnd } };
    const why = unmovableReason(t);
    if (why) {
      out.push({ ...base, to: null, why });
      continue;
    }
    const ids = t.assignees.map((a) => a.userId);
    if (t.deadlineOnly) {
      const due = await nextDueDay(ids, dateKey(notBefore, tz), tz, s.workEndMinutes);
      out.push({ ...base, to: due ? { start: due, end: due } : null, why: due ? null : "no-slot" });
      continue;
    }
    const extra = { hard: ids.flatMap((id) => hard.get(id) ?? []), booked };
    const slot = await proposeSlot(ids, t.allocatedMinutes, { requesterRole: "ADMIN", requesterId: actorId, excludeTaskId: t.id, from: notBefore, extra });
    if (!slot) {
      out.push({ ...base, to: null, why: "no-slot" });
      continue;
    }
    for (const id of ids) hard.set(id, [...(hard.get(id) ?? []), ...slot.chunks]);
    booked.push(...bookedRows(t.id, ids, slot.chunks, tz));
    out.push({ ...base, to: { start: slot.start, end: slot.end }, why: null });
  }
  return out;
}

async function loadRecord(id: string): Promise<{ rec: EarlyRecord; name: string }> {
  const r = await prisma.earlyLeave.findUnique({ where: { id }, include: { user: { select: { name: true } } } });
  if (!r || !r.active) throw new Error("That early leave is no longer active");
  return { rec: toRecord(r), name: r.user.name };
}

/** The confirm sheet: each flagged task with before → after, or "Move yourself". */
export async function planEarlyShift(id: string, actorId: string, now = new Date()): Promise<ShiftPlanItem[]> {
  const { rec } = await loadRecord(id);
  const tz = (await getSettings()).timezone;
  return planFor(rec, await flaggedTasks(rec, tz), actorId, now);
}

export type EarlyShiftResult = { shifted: number; manual: ShiftPlanItem[] };

/** Applies the plan: movable tasks go to their planned slot; the rest stay flagged for Admin to move. */
export async function shiftEarlyLeaveTasks(id: string, actorId: string, now = new Date()): Promise<EarlyShiftResult> {
  const { rec, name } = await loadRecord(id);
  const tz = (await getSettings()).timezone;
  const tasks = await flaggedTasks(rec, tz);
  const plan = await planFor(rec, tasks, actorId, now);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const reason = rec.mode === "UNTIL" ? `${first(name)} is away · moved after the time off` : `${first(name)} left early · moved to the next free slot`;
  let shifted = 0;
  for (const p of plan) {
    const t = byId.get(p.taskId);
    if (!p.to || !t) continue;
    await applyTaskMove(t, p.to, actorId, reason, { exceptActor: true });
    shifted++;
  }
  return { shifted, manual: plan.filter((p) => !p.to) };
}
