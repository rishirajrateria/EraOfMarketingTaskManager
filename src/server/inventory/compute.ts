/**
 * Pure inventory / capacity calculations (SPEC §9.3). No DB access so it is unit-testable.
 */
import { addDays } from "date-fns";
import type { AttendanceStatus, CompanySettings } from "@prisma/client";
import { dateKey, parseDateKey, zonedWeekday } from "@/lib/time";
import { productiveMinutesPerDay, type WorkingConfig } from "@/lib/working-time";

/** Date-only columns (`@db.Date`) are stored as UTC midnight of the local calendar date. */
export function toDbDate(key: string): Date {
  return parseDateKey(key, "UTC");
}

/** yyyy-MM-dd key of a `@db.Date` value read back from Prisma. */
export function fromDbDate(d: Date): string {
  return dateKey(d, "UTC");
}

/** Schema default for `CompanySettings.halfDayMinutes`; used when a caller passes a plain WorkingConfig. */
export const DEFAULT_HALF_DAY_MINUTES = 240;

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
  /** `dailyCapacityMinutes` overrides the full-day capacity only; half days always use the company setting. */
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
 * Capacity (productive minutes) of one person on one day.
 * - default = productive minutes/day from working hours minus lunch, or the user's override
 * - HALF_DAY → `settings.halfDayMinutes` (Settings → half-day hours), capped at the full day
 * - ABSENT / LEAVE / HOLIDAY, approved leave, holiday or non-working day → 0
 * - future days with no attendance row assume the person is present
 */
export function computeCapacityMinutes(input: CapacityInput): number {
  const { date, user, settings, attendanceStatus, onLeave, isHoliday } = input;
  if (isHoliday || onLeave) return 0;
  const weekday = zonedWeekday(date, settings.timezone);
  const userDays = user.workingDays.length ? user.workingDays : settings.workingDays;
  if (!settings.workingDays.includes(weekday) || !userDays.includes(weekday)) return 0;
  const full = user.dailyCapacityMinutes ?? productiveMinutesPerDay(settings);
  switch (attendanceStatus) {
    case "ABSENT":
    case "LEAVE":
    case "HOLIDAY":
      return 0;
    case "HALF_DAY":
      return Math.min(full, settings.halfDayMinutes ?? DEFAULT_HALF_DAY_MINUTES);
    default:
      return full;
  }
}

export type InventoryRow = {
  userId: string;
  name: string;
  teamId: string | null;
  date: string; // yyyy-MM-dd
  capacityMinutes: number;
  assignedMinutes: number;
  sellableMinutes: number;
};

export type InventoryTotals = { capacityMinutes: number; assignedMinutes: number; sellableMinutes: number };

export function sellable(capacityMinutes: number, assignedMinutes: number): number {
  return Math.max(0, capacityMinutes - assignedMinutes);
}

export function sumTotals(rows: Pick<InventoryRow, "capacityMinutes" | "assignedMinutes" | "sellableMinutes">[]): InventoryTotals {
  const t: InventoryTotals = { capacityMinutes: 0, assignedMinutes: 0, sellableMinutes: 0 };
  for (const r of rows) {
    t.capacityMinutes += r.capacityMinutes;
    t.assignedMinutes += r.assignedMinutes;
    t.sellableMinutes += r.sellableMinutes;
  }
  return t;
}
