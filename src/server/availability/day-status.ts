/**
 * ONE answer to "is this person available on this day, and when" (ADR 0019). Pure — no DB access.
 *
 * Precedence (identical everywhere: slot finder, inventory, Day view, attendance grid, HR tile):
 *   approved leave > company holiday > weekly off (company or the person's own working days)
 *   > attendance row (ABSENT / LEAVE / HOLIDAY / HALF_DAY) > working.
 * A PRESENT (or HALF_DAY) row on a leave / holiday / weekly-off day does not make the person available; it is flagged
 * with `presentOnOffDay` so screens can warn instead of showing a normal "Present".
 * Going home early (ADR 0022) sits right after the attendance row: the leaving day's window ends at `leftAt` (capacity
 * shrinks to what is left of it), every later covered day is AWAY.
 */
import type { AttendanceStatus } from "@prisma/client";
import { parseDateKey } from "@/lib/time";
import { minutesBetween, productiveMinutesPerDay, workingIntervalsForDay, type Interval, type WorkingConfig } from "@/lib/working-time";

export type DayKind = "WORKING" | "HALF" | "OFF_WEEKLY" | "HOLIDAY" | "LEAVE" | "ABSENT" | "AWAY";

/** Working-time config plus the capacity a HALF_DAY counts for (Settings → half-day hours). */
export type AvailabilityConfig = WorkingConfig & { halfDayMinutes?: number };

/** Schema default for `CompanySettings.halfDayMinutes`; used when a caller passes a plain WorkingConfig. */
export const DEFAULT_HALF_DAY_MINUTES = 240;

export type AttendanceMark = { status: AttendanceStatus; checkIn?: Date | null; checkOut?: Date | null };
export type AvailabilityUser = { dailyCapacityMinutes: number | null; workingDays: number[] };
/**
 * An early leave covering the day (ADR 0022). `leftAt` set: the leaving day (the window ends there); null: a later
 * covered day (the whole day is AWAY).
 */
export type AwayMark = { leftAt: Date | null; reason: string; earlyLeaveId?: string };

export type PersonDayInput = {
  user: AvailabilityUser;
  /** yyyy-MM-dd in the company time zone. */
  dayKey: string;
  cfg: AvailabilityConfig;
  /** An approved leave covers the day. */
  onLeave: boolean;
  /** The explicit attendance row for the day, if any. */
  attendance?: AttendanceMark | null;
  /** An active early leave covering the day (ADR 0022). */
  away?: AwayMark | null;
};

export type PersonDay = {
  kind: DayKind;
  /** The working time the person is available in that day (UTC instants, lunch excluded). Empty when off. */
  window: Interval[];
  /** Productive minutes the day counts for in inventory; also the most the slot finder books that day. */
  capacityMinutes: number;
  /** The attendance row, if any (shown by the grid even when the day is off). */
  marked: AttendanceStatus | null;
  /** A PRESENT / HALF_DAY row on a leave, holiday or weekly-off day: shown with a warning, never as normal Present. */
  presentOnOffDay: boolean;
  /** The early leave that shaped the day (leaving day or AWAY), if any (ADR 0022). */
  away: AwayMark | null;
};

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** "2026-10-31" + 1 → "2026-11-01": calendar arithmetic on the key itself (no zone, no DST). */
export function addKeyDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Overlap of two sorted interval lists. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = x.start > y.start ? x.start : y.start;
      const end = x.end < y.end ? x.end : y.end;
      if (end > start) out.push({ start, end });
    }
  }
  return out.sort((p, q) => p.start.getTime() - q.start.getTime());
}

/** Weekday (0 = Sunday) of a yyyy-MM-dd key — calendar arithmetic on the key, no zone. */
export function weekdayOfKey(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

/** The company's working intervals for the day (working hours minus lunch), ignoring weekly offs and holidays. */
export function companyDayIntervals(dayKey: string, cfg: WorkingConfig): Interval[] {
  return workingIntervalsForDay(parseDateKey(dayKey, cfg.timezone), { ...cfg, workingDays: ALL_DAYS, holidays: [] });
}

export function intervalMinutes(intervals: Interval[]): number {
  return intervals.reduce((s, i) => s + minutesBetween(i.start, i.end), 0);
}

/** The first `minutes` of the (sorted) intervals. */
export function firstMinutes(intervals: Interval[], minutes: number): Interval[] {
  const out: Interval[] = [];
  let left = Math.max(0, minutes);
  for (const i of intervals) {
    if (left <= 0) break;
    const take = Math.min(left, minutesBetween(i.start, i.end));
    if (take > 0) out.push({ start: i.start, end: new Date(i.start.getTime() + take * 60_000) });
    left -= take;
  }
  return out;
}

/** Everything of the (sorted) intervals after their first `minutes`. */
export function afterFirstMinutes(intervals: Interval[], minutes: number): Interval[] {
  const out: Interval[] = [];
  let left = Math.max(0, minutes);
  for (const i of intervals) {
    const len = minutesBetween(i.start, i.end);
    if (left >= len) {
      left -= len;
      continue;
    }
    out.push({ start: new Date(i.start.getTime() + left * 60_000), end: i.end });
    left = 0;
  }
  return out;
}

function clip(intervals: Interval[], from: Date, to: Date): Interval[] {
  return intervals
    .map((i) => ({ start: i.start > from ? i.start : from, end: i.end < to ? i.end : to }))
    .filter((i) => i.end > i.start);
}

/** Is the day a weekly off — not a company working day, or not one of the person's own working days? */
export function isWeeklyOff(dayKey: string, user: AvailabilityUser, cfg: WorkingConfig): boolean {
  const wd = weekdayOfKey(dayKey);
  const own = user.workingDays.length ? user.workingDays : cfg.workingDays;
  return !cfg.workingDays.includes(wd) || !own.includes(wd);
}

/**
 * The single function (ADR 0019): the person's status, available window and capacity on one day.
 * - WORKING: the company working day; capacity = the person's `dailyCapacityMinutes` or the productive day.
 * - HALF: `halfDayMinutes` (capped at the full capacity), inside the row's check-in/out window when set, else the
 *   first half of the working day; the window is never longer than the capacity.
 * - OFF_WEEKLY / HOLIDAY / LEAVE / ABSENT: no window, 0 capacity.
 */
export function personDayStatus(input: PersonDayInput): PersonDay {
  const { user, dayKey, cfg, onLeave } = input;
  const row = input.attendance ?? null;
  const marked = row?.status ?? null;
  const presentRow = marked === "PRESENT" || marked === "HALF_DAY";
  const off = (kind: DayKind, flag = false): PersonDay => ({ kind, window: [], capacityMinutes: 0, marked, presentOnOffDay: flag && presentRow, away: null });

  if (onLeave) return off("LEAVE", true);
  if (cfg.holidays.includes(dayKey)) return off("HOLIDAY", true);
  if (isWeeklyOff(dayKey, user, cfg)) return off("OFF_WEEKLY", true);
  if (marked === "ABSENT") return off("ABSENT");
  if (marked === "LEAVE") return off("LEAVE");
  if (marked === "HOLIDAY") return off("HOLIDAY");
  const away = input.away ?? null;
  if (away && !away.leftAt) return { ...off("AWAY"), away };

  const day = companyDayIntervals(dayKey, cfg);
  const full = user.dailyCapacityMinutes ?? productiveMinutesPerDay(cfg);
  let out: PersonDay;
  if (marked === "HALF_DAY") {
    const half = Math.min(full, cfg.halfDayMinutes ?? DEFAULT_HALF_DAY_MINUTES);
    const lo = row?.checkIn ?? new Date(0);
    const hi = row?.checkOut ?? new Date(8.64e15);
    const timed = (row?.checkIn || row?.checkOut) && hi > lo ? clip(day, lo, hi) : day;
    const window = firstMinutes(timed, half);
    out = { kind: "HALF", window, capacityMinutes: intervalMinutes(window), marked, presentOnOffDay: false, away: null };
  } else {
    out = { kind: "WORKING", window: day, capacityMinutes: full, marked, presentOnOffDay: false, away: null };
  }
  return away?.leftAt ? leftEarly(out, away) : out;
}

/** The leaving day (ADR 0022): the window ends at `leftAt`; capacity is at most the working time left before it. */
function leftEarly(d: PersonDay, away: AwayMark): PersonDay {
  const window = clip(d.window, new Date(0), away.leftAt!);
  return { ...d, window, capacityMinutes: Math.min(d.capacityMinutes, intervalMinutes(window)), away };
}

/** Off for the whole day (no time can be booked)? */
export const isDayOff = (d: PersonDay) => d.window.length === 0 || d.capacityMinutes <= 0;
