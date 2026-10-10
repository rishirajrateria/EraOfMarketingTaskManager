import { addDays } from "date-fns";
import type { AttendanceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, parseDateKey } from "@/lib/time";
import { inventoryFor } from "@/server/inventory/queries";
import { fromDbDate, toDbDate } from "@/server/inventory/compute";
import { APPROVED_LEAVE } from "@/server/leave/queries";
import { dashRange, type DashRange } from "@/server/dashboards/period";
import type { DashParams } from "@/server/dashboards/params";

/**
 * HR dashboard (ADR 0016): today's attendance and the team inventory (booked of capacity over the WHEN period) for
 * Team Leaders and Executives. Capacity and booked hours come from `inventoryFor` — the same numbers as the Inventory
 * page (capacity from working hours, attendance, approved leave and holidays; booked = open work tasks scheduled in
 * the period).
 */
export type TodayStatus = "PRESENT" | "HALF_DAY" | "LEAVE" | "ABSENT" | "HOLIDAY" | "NONE";
export type HrPerson = { userId: string; name: string; role: string; teamName: string | null; today: TodayStatus; capacityMin: number; bookedMin: number; freeMin: number; pct: number; daysOff: number };
export type HrDash = { range: DashRange; staff: number; presentToday: number; onLeaveToday: number; capacityMin: number; bookedMin: number; freeMin: number; people: HrPerson[] };

/** Attendance row first; an approved leave covering today without a row also counts as on leave. */
export function todayStatus(att: AttendanceStatus | null | undefined, onApprovedLeave: boolean): TodayStatus {
  if (att) return att;
  return onApprovedLeave ? "LEAVE" : "NONE";
}

/** Booked share of capacity, 0–100 (anything booked with no capacity reads as full). */
export function bookedPct(booked: number, capacity: number): number {
  if (capacity <= 0) return booked > 0 ? 100 : 0;
  return Math.min(100, Math.round((booked / capacity) * 100));
}

export async function hrDashboard(p: Pick<DashParams, "team" | "period">, now = new Date()): Promise<HrDash> {
  const tz = (await getSettings()).timezone;
  const range = dashRange(p.period, now, tz);
  const todayKey = dateKey(now, tz);
  const staff = await prisma.user.findMany({
    where: { active: true, role: { in: ["TEAM_LEADER", "EXECUTIVE"] }, ...(p.team ? { teamId: p.team } : {}) },
    select: { id: true, name: true, role: true, team: { select: { name: true } } },
    orderBy: [{ team: { name: "asc" } }, { role: "asc" }, { name: "asc" }],
  });
  const ids = staff.map((u) => u.id);
  const first = toDbDate(range.fromKey);
  const last = toDbDate(range.toKey);
  const [inv, attendance, leaves] = await Promise.all([
    inventoryFor({ from: parseDateKey(range.fromKey, tz), to: parseDateKey(range.toKey, tz) }, { teamId: p.team ?? undefined }),
    prisma.attendance.findMany({ where: { userId: { in: ids }, date: { gte: first, lte: last } }, select: { userId: true, date: true, status: true } }),
    prisma.leave.findMany({ where: { userId: { in: ids }, status: { in: APPROVED_LEAVE }, from: { lte: last }, to: { gte: first } }, select: { userId: true, from: true, to: true } }),
  ]);

  // Days off in the period: absent / leave attendance rows plus approved leave days (each day counted once).
  const off = new Map<string, Set<string>>();
  const mark = (u: string, k: string) => {
    if (k < range.fromKey || k > range.toKey) return;
    off.set(u, (off.get(u) ?? new Set()).add(k));
  };
  for (const a of attendance) if (a.status === "ABSENT" || a.status === "LEAVE") mark(a.userId, fromDbDate(a.date));
  for (const l of leaves) for (let d = l.from; d <= l.to; d = addDays(d, 1)) mark(l.userId, fromDbDate(d));
  const attToday = new Map(attendance.filter((a) => fromDbDate(a.date) === todayKey).map((a) => [a.userId, a.status]));
  const leaveToday = new Set(leaves.filter((l) => fromDbDate(l.from) <= todayKey && fromDbDate(l.to) >= todayKey).map((l) => l.userId));

  const people: HrPerson[] = staff.map((u) => {
    const t = inv.users.find((x) => x.userId === u.id);
    const capacityMin = t?.capacityMinutes ?? 0;
    const bookedMin = t?.assignedMinutes ?? 0;
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      teamName: u.team?.name ?? null,
      today: todayStatus(attToday.get(u.id), leaveToday.has(u.id)),
      capacityMin,
      bookedMin,
      freeMin: Math.max(0, capacityMin - bookedMin),
      pct: bookedPct(bookedMin, capacityMin),
      daysOff: off.get(u.id)?.size ?? 0,
    };
  });
  const capacityMin = people.reduce((s, x) => s + x.capacityMin, 0);
  const bookedMin = people.reduce((s, x) => s + x.bookedMin, 0);
  return {
    range,
    staff: people.length,
    presentToday: people.filter((x) => x.today === "PRESENT" || x.today === "HALF_DAY").length,
    onLeaveToday: people.filter((x) => x.today === "LEAVE").length,
    capacityMin,
    bookedMin,
    freeMin: Math.max(0, capacityMin - bookedMin),
    people,
  };
}
