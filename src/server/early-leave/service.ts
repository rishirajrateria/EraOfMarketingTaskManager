/**
 * Going home early (ADR 0022): mark, cancel, the morning "Is <Name> back today?" and its answers, and which tasks are
 * flagged "Needs shifting". Not server actions (see ./actions.ts for the role checks); the job and tests call these.
 * Availability itself is NOT computed here: an active EarlyLeave row is read by `loadAvailability` →
 * `personDayStatus`, so inventory, the add-task header, the HR tile and the slot finder all follow it.
 */
import type { EarlyLeave, EarlyLeaveMode, EarlyLeaveReason } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { bus } from "@/lib/events";
import { getSettings } from "@/lib/settings";
import { dateKey, hhmmToMinutes, parseDateKey, zonedDayAt } from "@/lib/time";
import { adminIds, notify } from "@/lib/notify";
import { backQuestionPhrase, earlyLeftPhrase, stillOffPhrase } from "@/lib/notification-text";
import { fromDbDate, toDbDate } from "@/server/inventory/compute";
import { coverPeriod, hitsPeriod, periodDetail, type EarlyRecord, type Period } from "@/server/early-leave/core";

export function toRecord(r: EarlyLeave): EarlyRecord {
  return {
    id: r.id,
    userId: r.userId,
    day: fromDbDate(r.day),
    leftAt: r.leftAt,
    reason: r.reason,
    mode: r.mode,
    until: r.until ? fromDbDate(r.until) : null,
    coveredThrough: fromDbDate(r.coveredThrough),
    askDay: r.askDay ? fromDbDate(r.askDay) : null,
    backOn: r.backOn ? fromDbDate(r.backOn) : null,
    active: r.active,
  };
}

/** Admins and HR: who is told, asked and allowed to mark. */
export async function adminAndHrIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "HR"] }, active: true }, select: { id: true, role: true } });
  return rows.map((r) => r.id);
}

const FLAG_STATUSES = ["ASSIGNED", "STARTED", "PAUSED", "FINISH_REQUESTED"] as const;

export type FlaggedTask = {
  id: string;
  title: string;
  type: "WORK" | "MEETING";
  status: string;
  protected: boolean;
  deadlineOnly: boolean;
  allocatedMinutes: number;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  assignees: { userId: string }[];
};

/** The person's open tasks whose scheduled time falls in the period (`hitsPeriod`), in schedule order. */
export async function tasksInPeriod(userId: string, p: Period): Promise<FlaggedTask[]> {
  const rows = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: { in: [...FLAG_STATUSES] },
      assignees: { some: { userId } },
      scheduledStart: { lt: p.to },
      OR: [{ scheduledEnd: { gt: p.from } }, { scheduledEnd: null, scheduledStart: { gte: p.from } }, { deadlineOnly: true, scheduledStart: { gte: p.from } }],
    },
    select: { id: true, title: true, type: true, status: true, protected: true, deadlineOnly: true, allocatedMinutes: true, scheduledStart: true, scheduledEnd: true, assignees: { select: { userId: true } } },
    orderBy: [{ scheduledStart: "asc" }, { createdAt: "asc" }],
  });
  return rows.filter((t) => hitsPeriod(t, p));
}

/** The tasks an early leave flags "Needs shifting" (none once it is cancelled). */
export async function flaggedTasks(rec: EarlyRecord, tz: string): Promise<FlaggedTask[]> {
  return rec.active ? tasksInPeriod(rec.userId, coverPeriod(rec, tz)) : [];
}

export type MarkInput = { userId: string; leftAt: string; reason: EarlyLeaveReason; mode: EarlyLeaveMode; until?: string | null };

/** "Left at" HH:mm today (company zone) → the instant; the covered days. Throws on a bad "Away until…" day. */
export function resolveMark(input: Pick<MarkInput, "leftAt" | "mode" | "until">, tz: string, now: Date) {
  const day = dateKey(now, tz);
  if (!/^\d{2}:\d{2}$/.test(input.leftAt)) throw new Error("Set the time they left");
  const leftAt = zonedDayAt(parseDateKey(day, tz), hhmmToMinutes(input.leftAt), tz);
  if (input.mode === "UNTIL") {
    if (!input.until || !/^\d{4}-\d{2}-\d{2}$/.test(input.until)) throw new Error("Pick the last day away");
    if (input.until < day) throw new Error("The last day away can't be before today");
  }
  const coveredThrough = input.mode === "UNTIL" ? input.until! : day;
  return { day, leftAt, coveredThrough };
}

/** "N tasks of <Name> will be flagged for shifting" — the sheet's live preview, same query as the real flags. */
export async function previewFlagCount(input: MarkInput, now = new Date()): Promise<number> {
  const tz = (await getSettings()).timezone;
  const { leftAt, coveredThrough } = resolveMark(input, tz, now);
  return (await tasksInPeriod(input.userId, coverPeriod({ leftAt, coveredThrough }, tz))).length;
}

const changed = (userId: string) => {
  bus.publish({ type: "leave.changed", userId });
  bus.publish({ type: "requests.changed" });
};

/**
 * Marks someone as gone home early. One active early leave per person: an earlier one is replaced. Admins and HR
 * (minus the one who marked it) get EARLY_LEAVE; HR's copy says Admin will shift the tasks.
 */
export async function markEarlyLeave(actorId: string, input: MarkInput, now = new Date()): Promise<{ id: string; flagged: number }> {
  const tz = (await getSettings()).timezone;
  const person = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, active: true } });
  if (!person || !person.active) throw new Error("Person not found");
  const { day, leftAt, coveredThrough } = resolveMark(input, tz, now);
  const row = await prisma.$transaction(async (tx) => {
    await tx.earlyLeave.updateMany({ where: { userId: person.id, active: true }, data: { active: false, cancelledAt: now, cancelledById: actorId } });
    const r = await tx.earlyLeave.create({
      data: {
        userId: person.id,
        day: toDbDate(day),
        leftAt,
        reason: input.reason,
        mode: input.mode,
        until: input.mode === "UNTIL" ? toDbDate(coveredThrough) : null,
        coveredThrough: toDbDate(coveredThrough),
        createdById: actorId,
      },
    });
    await audit(actorId, "earlyLeave.mark", "EarlyLeave", r.id, null, r, tx);
    return r;
  });
  const rec = toRecord(row);
  const flagged = (await flaggedTasks(rec, tz)).length;
  await tellAdminsAndHr(rec, person.name, flagged, actorId, tz);
  changed(person.id);
  return { id: row.id, flagged };
}

async function tellAdminsAndHr(rec: EarlyRecord, name: string, flagged: number, actorId: string, tz: string) {
  const people = await prisma.user.findMany({ where: { role: { in: ["ADMIN", "HR"] }, active: true }, select: { id: true, role: true } });
  const detail = periodDetail(rec, tz);
  const title = earlyLeftPhrase(name, flagged);
  const admins = people.filter((p) => p.role === "ADMIN").map((p) => p.id);
  const hr = people.filter((p) => p.role === "HR").map((p) => p.id);
  await notify({ userIds: admins, kind: "EARLY_LEAVE", title, body: detail, href: "/dashboard", exceptUserId: actorId });
  await notify({ userIds: hr, kind: "EARLY_LEAVE", title, body: flagged ? `${detail} · Admin will shift these` : detail, href: "/attendance", exceptUserId: actorId });
}

async function loadActive(id: string): Promise<EarlyLeave> {
  const r = await prisma.earlyLeave.findUnique({ where: { id } });
  if (!r || !r.active) throw new Error("That early leave is no longer active");
  return r;
}

/** The morning question's feed rows for this early leave are answered: mark them read for everyone. */
async function closeQuestion(id: string, now: Date) {
  await prisma.notification.updateMany({ where: { kind: "BACK_QUESTION", href: { contains: `ask=${id}` }, readAt: null }, data: { readAt: now } });
}

/** Cancels an early leave: availability, flags and questions all go back to normal. */
export async function cancelEarlyLeave(actorId: string, id: string, now = new Date()) {
  const r = await loadActive(id);
  const after = await prisma.earlyLeave.update({ where: { id }, data: { active: false, cancelledAt: now, cancelledById: actorId, askDay: null } });
  await audit(actorId, "earlyLeave.cancel", "EarlyLeave", id, r, after);
  await closeQuestion(id, now);
  changed(r.userId);
}

/**
 * Answers "Is <Name> back today?". Back: no more questions (the covered days stay as they were). Still off: that day
 * (and any day since, when answered late) is covered too, Admins hear how many tasks now need shifting, and the job
 * asks again the following working morning.
 */
export async function answerBack(actorId: string, id: string, back: boolean, now = new Date()): Promise<{ flagged: number }> {
  const r = await loadActive(id);
  if (r.mode !== "ASK" || !r.askDay) throw new Error("Nothing to answer for this early leave");
  const tz = (await getSettings()).timezone;
  const asked = fromDbDate(r.askDay);
  const today = dateKey(now, tz);
  const data = back
    ? { backOn: r.askDay, askDay: null }
    : { coveredThrough: toDbDate(asked > today ? asked : today), askDay: null };
  const after = await prisma.earlyLeave.update({ where: { id }, data });
  await audit(actorId, back ? "earlyLeave.back" : "earlyLeave.stillOff", "EarlyLeave", id, r, after);
  await closeQuestion(id, now);
  let flagged = 0;
  if (!back) {
    const rec = toRecord(after);
    flagged = (await flaggedTasks(rec, tz)).length;
    const person = await prisma.user.findUnique({ where: { id: r.userId }, select: { name: true } });
    if (flagged) await notify({ userIds: await adminIds(), kind: "EARLY_LEAVE", title: stillOffPhrase(person?.name, flagged), body: periodDetail(rec, tz), href: "/dashboard", exceptUserId: actorId });
  }
  changed(r.userId);
  return { flagged };
}

/** Is `key` a company working day (working weekday, not a holiday)? */
function companyWorkingDay(key: string, workingDays: number[], holidays: string[]): boolean {
  return workingDays.includes(new Date(`${key}T00:00:00Z`).getUTCDay()) && !holidays.includes(key);
}

/** The morning starts this long before the working day: the question is waiting when people arrive. */
export const ASK_LEAD_MINUTES = 120;

/**
 * The morning job (ADR 0022): on each company working day, from 2h before work starts, every open "Ask tomorrow" early
 * leave whose covered days are over and that has no question waiting gets "Is <Name> back today?" — a card at the top
 * of Requests (Admin) and Attendance (HR and Admin) and a BACK_QUESTION notification. Idempotent.
 */
export async function askWhoIsBack(now = new Date()): Promise<{ asked: number }> {
  const s = await getSettings();
  const tz = s.timezone;
  const today = dateKey(now, tz);
  const holidays = s.holidays.map(fromDbDate);
  if (!companyWorkingDay(today, s.workingDays, holidays)) return { asked: 0 };
  const morning = zonedDayAt(parseDateKey(today, tz), Math.max(0, s.workStartMinutes - ASK_LEAD_MINUTES), tz);
  if (now < morning) return { asked: 0 };
  const open = await prisma.earlyLeave.findMany({
    where: { active: true, mode: "ASK", backOn: null, askDay: null, coveredThrough: { lt: toDbDate(today) } },
    include: { user: { select: { name: true } } },
  });
  const ask = await adminAndHrIds();
  const admins = await adminIds();
  let asked = 0;
  for (const r of open) {
    const claimed = await prisma.earlyLeave.updateMany({ where: { id: r.id, askDay: null }, data: { askDay: toDbDate(today), askedAt: now } });
    if (!claimed.count) continue;
    asked++;
    const title = backQuestionPhrase(r.user.name);
    await notify({ userIds: ask.filter((id) => admins.includes(id)), kind: "BACK_QUESTION", title, body: "Back or Still off", href: `/admin/requests?ask=${r.id}` });
    await notify({ userIds: ask.filter((id) => !admins.includes(id)), kind: "BACK_QUESTION", title, body: "Back or Still off", href: `/attendance?ask=${r.id}` });
    changed(r.userId);
  }
  return { asked };
}
