/**
 * Pure inventory / capacity calculations (SPEC §9.3). No DB access so it is unit-testable.
 */
import { addDays } from "date-fns";
import type { AttendanceStatus, CompanySettings } from "@prisma/client";
import { dateKey, parseDateKey } from "@/lib/time";
import type { WorkingConfig } from "@/lib/working-time";
import { DEFAULT_HALF_DAY_MINUTES, personDayStatus, type DayKind } from "@/server/availability/day-status";

/** Date-only columns (`@db.Date`) are stored as UTC midnight of the local calendar date. */
export function toDbDate(key: string): Date {
  return parseDateKey(key, "UTC");
}

/** yyyy-MM-dd key of a `@db.Date` value read back from Prisma. */
export function fromDbDate(d: Date): string {
  return dateKey(d, "UTC");
}

export { DEFAULT_HALF_DAY_MINUTES };

/** Working-time config plus the capacity a HALF_DAY counts for (Settings → half-day hours). */
export type CapacityConfig = WorkingConfig & { halfDayMinutes: number };

export function toWorkingConfig(s: CompanySettings): CapacityConfig {
  return {
    halfDayMinutes: s.halfDayMinutes,
    timezone: s.timezone,
    workStartMinutes: s.workStartMinutes,
    workEndMinutes: s.workEndMinutes,
    lunchStartMinutes: s.lunchStartMinutes,
    lunchEndMinutes: s.lunchEndMinutes,
    workingDays: s.workingDays,
    holidays: s.holidays.map(fromDbDate),
  };
}

/** Inclusive list of yyyy-MM-dd keys between two instants, in the given timezone. */
export function dayKeysBetween(from: Date, to: Date, tz: string): string[] {
  const keys: string[] = [];
  const last = dateKey(to, tz);
  let d = parseDateKey(dateKey(from, tz), tz);
  for (let i = 0; i < 400; i++) {
    const k = dateKey(d, tz);
    keys.push(k);
    if (k >= last) break;
    d = addDays(d, 1);
  }
  return keys;
}

export type CapacityInput = {
  /** Any instant on the day in question (interpreted in `settings.timezone`). */
  date: Date;
  /** `dailyCapacityMinutes` overrides the full-day capacity; a half day is capped at it. */
  user: { dailyCapacityMinutes: number | null; workingDays: number[] };
  settings: WorkingConfig & { halfDayMinutes?: number };
  /** Explicit attendance row for the day, if any. */
  attendanceStatus?: AttendanceStatus | null;
  /** Approved leave covers this day. */
  onLeave: boolean;
  /** Company holiday. */
  isHoliday: boolean;
};

/**
 * Capacity (productive minutes) of one person on one day — a thin wrapper over `personDayStatus` (ADR 0019), so the
 * precedence (leave > holiday > weekly off > attendance row > working) is the same as everywhere else.
 */
export function computeCapacityMinutes(input: CapacityInput): number {
  const { date, user, settings, attendanceStatus, onLeave, isHoliday } = input;
  const dayKey = dateKey(date, settings.timezone);
  const cfg = isHoliday && !settings.holidays.includes(dayKey) ? { ...settings, holidays: [...settings.holidays, dayKey] } : settings;
  return personDayStatus({ user, dayKey, cfg, onLeave, attendance: attendanceStatus ? { status: attendanceStatus } : null }).capacityMinutes;
}

export type InventoryRow = {
  userId: string;
  name: string;
  teamId: string | null;
  date: string; // yyyy-MM-dd
  /** The person's day per `personDayStatus` (WORKING / HALF / OFF_WEEKLY / HOLIDAY / LEAVE / ABSENT). */
  kind: DayKind;
  capacityMinutes: number;
  assignedMinutes: number;
  sellableMinutes: number;
  /** Booked beyond capacity that day (sellable clamps at 0; this shows by how much) — "over by 2h". */
  overbookedMinutes: number;
};

export type InventoryTotals = { capacityMinutes: number; assignedMinutes: number; sellableMinutes: number; overbookedMinutes: number };

export function sellable(capacityMinutes: number, assignedMinutes: number): number {
  return Math.max(0, capacityMinutes - assignedMinutes);
}

/** Minutes booked beyond capacity (0 when within). */
export function overbooked(capacityMinutes: number, assignedMinutes: number): number {
  return Math.max(0, assignedMinutes - capacityMinutes);
}

/**
 * Sums per-day rows. `overbookedMinutes` is the sum of each day's overbooking (a free Tuesday does not cancel an
 * overbooked Monday), so a total can show both sellable time and "over by".
 */
export function sumTotals(rows: Pick<InventoryRow, "capacityMinutes" | "assignedMinutes" | "sellableMinutes" | "overbookedMinutes">[]): InventoryTotals {
  const t: InventoryTotals = { capacityMinutes: 0, assignedMinutes: 0, sellableMinutes: 0, overbookedMinutes: 0 };
  for (const r of rows) {
    t.capacityMinutes += r.capacityMinutes;
    t.assignedMinutes += r.assignedMinutes;
    t.sellableMinutes += r.sellableMinutes;
    t.overbookedMinutes += r.overbookedMinutes ?? 0;
  }
  return t;
}
