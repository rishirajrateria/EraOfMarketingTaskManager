import { addDays, addMonths, addWeeks, differenceInCalendarWeeks, getDaysInMonth, startOfDay, startOfMonth } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { MonthAnchor, RecurrenceFrequency } from "@prisma/client";

/**
 * Pure next-occurrence math for invoice schedules (SPEC §11.3 recurring invoices, ADR 0005 / ADR 0007).
 * Month-anchored rules land on the 1st (START), the last day (END) or `dayOfMonth` (DAY, 1–28) of the month, at
 * `notifyMinutes` after local midnight in the company timezone (default 09:00). Other frequencies keep the
 * time-of-day of `from` unless `notifyMinutes` is set. Weekday checks use UTC (the job runs in UTC).
 */
export type RuleLike = {
  frequency: RecurrenceFrequency;
  interval?: number | null;
  byWeekday?: number[] | null;
  monthAnchor?: MonthAnchor | null;
  dayOfMonth?: number | null;
  notifyMinutes?: number | null;
  endDate?: Date | null;
  stopped?: boolean | null;
};

export const DEFAULT_TZ = "Asia/Kolkata";
export const DEFAULT_NOTIFY_MINUTES = 540; // 09:00
const MAX_SCAN_DAYS = 400;

const clampDay = (day: number | null | undefined) => Math.min(28, Math.max(1, Math.round(day ?? 1)));

function atMinutes(localMidnight: Date, minutes: number): Date {
  const d = new Date(localMidnight);
  d.setMinutes(Math.max(0, Math.min(1439, minutes)));
  return d;
}

/**
 * Anchor day of the month `interval` months after `from` (START = 1st, END = last day, DAY = `dayOfMonth`), at
 * `notifyMinutes` local time in `tz` (default 09:00). Returns the UTC instant.
 */
export function anchoredMonthDate(from: Date, anchor: Exclude<MonthAnchor, "NONE">, interval: number, tz: string, dayOfMonth?: number | null, notifyMinutes?: number | null): Date {
  const local = toZonedTime(from, tz);
  const month = addMonths(startOfMonth(local), interval);
  const day = anchor === "START" ? 1 : anchor === "END" ? getDaysInMonth(month) : Math.min(clampDay(dayOfMonth), getDaysInMonth(month));
  const localDay = startOfDay(new Date(month.getFullYear(), month.getMonth(), day));
  return fromZonedTime(atMinutes(localDay, notifyMinutes ?? DEFAULT_NOTIFY_MINUTES), tz);
}

/** Same calendar day as `d` (in `tz`) at `minutes` after local midnight. */
function withLocalTime(d: Date, minutes: number, tz: string): Date {
  return fromZonedTime(atMinutes(startOfDay(toZonedTime(d, tz)), minutes), tz);
}

export function nextOccurrence(from: Date, rule: RuleLike, tz: string = DEFAULT_TZ): Date {
  const interval = Math.max(1, rule.interval ?? 1);
  const timed = (d: Date) => (rule.notifyMinutes == null ? d : withLocalTime(d, rule.notifyMinutes, tz));
  switch (rule.frequency) {
    case "DAILY":
      return timed(addDays(from, interval));
    case "MONTHLY":
      if (rule.monthAnchor && rule.monthAnchor !== "NONE") return anchoredMonthDate(from, rule.monthAnchor, interval, tz, rule.dayOfMonth, rule.notifyMinutes);
      return timed(addMonths(from, interval));
    case "CUSTOM":
      return timed(addDays(from, interval));
    case "WEEKLY": {
      const days = (rule.byWeekday ?? []).filter((d) => d >= 0 && d <= 6);
      if (days.length === 0) return timed(addWeeks(from, interval));
      for (let i = 1; i <= MAX_SCAN_DAYS; i++) {
        const d = addDays(from, i);
        if (!days.includes(d.getUTCDay())) continue;
        const weeks = differenceInCalendarWeeks(d, from, { weekStartsOn: 1 });
        if (weeks % interval === 0) return timed(d);
      }
      return timed(addWeeks(from, interval));
    }
  }
}

/** First occurrence strictly after `now`, starting from `current` (catch-up without duplicating missed runs). */
export function nextOccurrenceAfter(current: Date, rule: RuleLike, now: Date, tz: string = DEFAULT_TZ): Date {
  let next = nextOccurrence(current, rule, tz);
  let guard = 0;
  while (next <= now && guard++ < 10_000) next = nextOccurrence(next, rule, tz);
  return next;
}

export function isRuleActive(rule: RuleLike, now: Date): boolean {
  if (rule.stopped) return false;
  if (rule.endDate && rule.endDate < now) return false;
  return true;
}

/** Due date for a generated occurrence: keep the template's (dueDate − issueDate) offset. */
export function shiftedDueDate(templateIssuedAt: Date, templateDueDate: Date | null, occurrenceAt: Date, fallbackDays = 15): Date {
  const offsetMs = templateDueDate ? templateDueDate.getTime() - templateIssuedAt.getTime() : fallbackDays * 86_400_000;
  return new Date(occurrenceAt.getTime() + Math.max(0, offsetMs));
}

/** "1st of the month" / "last day of the month" / "the 15th" + " at 09:00" for UI summaries. */
export function describeMonthAnchor(anchor: MonthAnchor | string | null | undefined, dayOfMonth?: number | null): string {
  if (anchor === "START") return "1st of the month";
  if (anchor === "END") return "last day of the month";
  if (anchor === "DAY") {
    const d = clampDay(dayOfMonth);
    const unit = d % 10;
    const suffix = d >= 11 && d <= 13 ? "th" : unit === 1 ? "st" : unit === 2 ? "nd" : unit === 3 ? "rd" : "th";
    return `the ${d}${suffix}`;
  }
  return "same day";
}
