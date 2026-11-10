import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, parseDateKey } from "@/lib/time";
import { inventoryFor } from "@/server/inventory/queries";
import { toWorkingConfig } from "@/server/inventory/compute";
import { addKeyDays, type PersonDay } from "@/server/availability/day-status";
import { loadAvailability, loadPeople } from "@/server/availability/load";
import { dashRange, type DashRange } from "@/server/dashboards/period";
import type { DashParams } from "@/server/dashboards/params";

/**
 * HR dashboard (ADR 0016): today's attendance and the team inventory (booked of capacity over the WHEN period) for
 * Team Leaders and Executives. Capacity and booked hours come from `inventoryFor` — the same numbers as the Inventory
 * page — and today's status from `personDayStatus` (ADR 0019), the same precedence as the grid and the slot finder.
 */
export type TodayStatus = "PRESENT" | "HALF_DAY" | "LEAVE" | "ABSENT" | "HOLIDAY" | "OFF" | "NONE";
export type HrPerson = {
  userId: string;
  name: string;
  role: string;
  teamName: string | null;
  today: TodayStatus;
  /** Marked present on a leave / holiday / weekly-off day: shown with a warning. */
  todayWarning: boolean;
  capacityMin: number;
  bookedMin: number;
  freeMin: number;
  /** Booked beyond capacity over the period (sum of each day's overbooking). */
  overMin: number;
  pct: number;
  daysOff: number;
};
export type HrDash = { range: DashRange; staff: number; presentToday: number; onLeaveToday: number; capacityMin: number; bookedMin: number; freeMin: number; people: HrPerson[] };

/** Today's tile label from the person's day (leave > holiday > weekly off > attendance row > working). */
export function todayStatus(day: Pick<PersonDay, "kind" | "marked">): TodayStatus {
  switch (day.kind) {
    case "LEAVE":
    case "HOLIDAY":
    case "ABSENT":
      return day.kind;
    case "OFF_WEEKLY":
      return "OFF";
    case "HALF":
      return "HALF_DAY";
    default:
      return day.marked === "PRESENT" ? "PRESENT" : "NONE";
  }
}

/** Booked share of capacity, 0–100 (anything booked with no capacity reads as full). */
export function bookedPct(booked: number, capacity: number): number {
  if (capacity <= 0) return booked > 0 ? 100 : 0;
  return Math.min(100, Math.round((booked / capacity) * 100));
}

export async function hrDashboard(p: Pick<DashParams, "team" | "period">, now = new Date()): Promise<HrDash> {
  const settings = await getSettings();
  const cfg = toWorkingConfig(settings);
  const tz = cfg.timezone;
  const range = dashRange(p.period, now, tz);
  const todayKey = dateKey(now, tz);
  const staff = await prisma.user.findMany({
    where: { active: true, role: { in: ["TEAM_LEADER", "EXECUTIVE"] }, ...(p.team ? { teamId: p.team } : {}) },
    select: { id: true, name: true, role: true, team: { select: { name: true } } },
    orderBy: [{ team: { name: "asc" } }, { role: "asc" }, { name: "asc" }],
  });
  const lo = todayKey < range.fromKey ? todayKey : range.fromKey;
  const hi = todayKey > range.toKey ? todayKey : range.toKey;
  const [inv, availability] = await Promise.all([
    inventoryFor({ from: parseDateKey(range.fromKey, tz), to: parseDateKey(range.toKey, tz) }, { teamId: p.team ?? undefined }),
    loadPeople(staff.map((u) => u.id)).then((people) => loadAvailability(people, lo, hi, cfg)),
  ]);

  const people: HrPerson[] = staff.map((u) => {
    const t = inv.users.find((x) => x.userId === u.id);
    const capacityMin = t?.capacityMinutes ?? 0;
    const bookedMin = t?.assignedMinutes ?? 0;
    // Days off in the period: leave and absent days (approved leave or an attendance row), each counted once.
    let daysOff = 0;
    for (let k = range.fromKey, i = 0; k <= range.toKey && i < 400; k = addKeyDays(k, 1), i++) {
      const kind = availability.day(u.id, k).kind;
      if (kind === "LEAVE" || kind === "ABSENT") daysOff++;
    }
    const today = availability.day(u.id, todayKey);
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      teamName: u.team?.name ?? null,
      today: todayStatus(today),
      todayWarning: today.presentOnOffDay,
      capacityMin,
      bookedMin,
      freeMin: Math.max(0, capacityMin - bookedMin),
      overMin: t?.overbookedMinutes ?? 0,
      pct: bookedPct(bookedMin, capacityMin),
      daysOff,
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
