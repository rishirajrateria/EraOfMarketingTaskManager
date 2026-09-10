/**
 * Pure working-time calculations (SPEC §9.1). No DB access so it is unit-testable.
 */
import { addDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { dateKey, zonedDayAt, zonedStartOfDay } from "@/lib/time";

export type WorkingConfig = {
  timezone: string;
  workStartMinutes: number; // minutes from midnight local
  workEndMinutes: number;
  lunchStartMinutes: number;
  lunchEndMinutes: number;
  workingDays: number[]; // 0=Sun..6=Sat
  holidays: string[]; // yyyy-MM-dd keys
};

export type Interval = { start: Date; end: Date };

export const DEFAULT_WORKING: WorkingConfig = {
  timezone: "Asia/Kolkata",
  workStartMinutes: 600,
  workEndMinutes: 1140,
  lunchStartMinutes: 810,
  lunchEndMinutes: 870,
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: [],
};

export function productiveMinutesPerDay(c: WorkingConfig): number {
  return c.workEndMinutes - c.workStartMinutes - (c.lunchEndMinutes - c.lunchStartMinutes);
}

export function isWorkingDay(day: Date, c: WorkingConfig, extraOff: Set<string> = new Set()): boolean {
  const local = toZonedTime(day, c.timezone);
  if (!c.workingDays.includes(local.getDay())) return false;
  const key = dateKey(day, c.timezone);
  if (c.holidays.includes(key)) return false;
  if (extraOff.has(key)) return false;
  return true;
}

/** Working intervals (excluding lunch) for one calendar day, in UTC instants. */
export function workingIntervalsForDay(day: Date, c: WorkingConfig, extraOff?: Set<string>): Interval[] {
  if (!isWorkingDay(day, c, extraOff)) return [];
  const out: Interval[] = [];
  const s = zonedDayAt(day, c.workStartMinutes, c.timezone);
  const ls = zonedDayAt(day, c.lunchStartMinutes, c.timezone);
  const le = zonedDayAt(day, c.lunchEndMinutes, c.timezone);
  const e = zonedDayAt(day, c.workEndMinutes, c.timezone);
  if (ls > s && le < e) {
    out.push({ start: s, end: ls }, { start: le, end: e });
  } else {
    out.push({ start: s, end: e });
  }
  return out;
}

/** Subtract busy intervals from free intervals. */
export function subtractIntervals(free: Interval[], busy: Interval[]): Interval[] {
  let result = free.map((f) => ({ ...f }));
  for (const b of busy) {
    const next: Interval[] = [];
    for (const f of result) {
      if (b.end <= f.start || b.start >= f.end) {
        next.push(f);
        continue;
      }
      if (b.start > f.start) next.push({ start: f.start, end: b.start });
      if (b.end < f.end) next.push({ start: b.end, end: f.end });
    }
    result = next;
  }
  return result.filter((i) => i.end > i.start);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

/** Total working minutes of `intervals` clipped to [from, to). */
export function clipMinutes(intervals: Interval[], from: Date, to: Date): number {
  let total = 0;
  for (const i of intervals) {
    const s = i.start > from ? i.start : from;
    const e = i.end < to ? i.end : to;
    if (e > s) total += minutesBetween(s, e);
  }
  return total;
}

/**
 * First contiguous gap ≥ `minutes` at/after `from` in the free timeline.
 * Tasks may span days (SPEC §9.2 step 2): if `allowSplit`, we allocate across consecutive
 * free intervals and return the whole span (sessions = the free chunks).
 */
export function findSlot(
  from: Date,
  minutes: number,
  c: WorkingConfig,
  busy: Interval[],
  opts: { extraOff?: Set<string>; maxDays?: number; allowSplit?: boolean } = {},
): { start: Date; end: Date; chunks: Interval[] } | null {
  const maxDays = opts.maxDays ?? 90;
  const allowSplit = opts.allowSplit ?? true;
  let day = zonedStartOfDay(from, c.timezone);
  let chunks: Interval[] = [];
  let remaining = minutes;
  for (let i = 0; i < maxDays; i++) {
    const free = subtractIntervals(workingIntervalsForDay(day, c, opts.extraOff), busy)
      .map((iv) => ({ start: iv.start > from ? iv.start : from, end: iv.end }))
      .filter((iv) => iv.end > iv.start)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    for (const iv of free) {
      const len = minutesBetween(iv.start, iv.end);
      if (!allowSplit) {
        if (len >= minutes) {
          const end = new Date(iv.start.getTime() + minutes * 60000);
          return { start: iv.start, end, chunks: [{ start: iv.start, end }] };
        }
        continue;
      }
      // contiguous-with-previous-chunk check: a gap in free time (lunch/overnight/busy) is allowed; we keep spanning
      const take = Math.min(len, remaining);
      const end = new Date(iv.start.getTime() + take * 60000);
      chunks.push({ start: iv.start, end });
      remaining -= take;
      if (remaining <= 0) {
        return { start: chunks[0].start, end, chunks };
      }
    }
    day = addDays(day, 1);
    // If nothing was taken today and we already had chunks, keep spanning (multi-day is allowed).
    if (chunks.length === 0) chunks = [];
  }
  return null;
}
