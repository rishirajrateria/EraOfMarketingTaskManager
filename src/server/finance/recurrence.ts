import { addDays, addMonths, addWeeks, differenceInCalendarWeeks } from "date-fns";
import type { RecurrenceFrequency } from "@prisma/client";

/**
 * Pure next-occurrence math for invoice schedules (SPEC §11.3 recurring invoices).
 * Time-of-day of `from` is preserved; weekday checks use UTC (the job runs in UTC).
 */
export type RuleLike = {
  frequency: RecurrenceFrequency;
  interval?: number | null;
  byWeekday?: number[] | null;
  endDate?: Date | null;
  stopped?: boolean | null;
};

const MAX_SCAN_DAYS = 400;

export function nextOccurrence(from: Date, rule: RuleLike): Date {
  const interval = Math.max(1, rule.interval ?? 1);
  switch (rule.frequency) {
    case "DAILY":
      return addDays(from, interval);
    case "MONTHLY":
      return addMonths(from, interval);
    case "CUSTOM":
      return addDays(from, interval);
    case "WEEKLY": {
      const days = (rule.byWeekday ?? []).filter((d) => d >= 0 && d <= 6);
      if (days.length === 0) return addWeeks(from, interval);
      for (let i = 1; i <= MAX_SCAN_DAYS; i++) {
        const d = addDays(from, i);
        if (!days.includes(d.getUTCDay())) continue;
        const weeks = differenceInCalendarWeeks(d, from, { weekStartsOn: 1 });
        if (weeks % interval === 0) return d;
      }
      return addWeeks(from, interval);
    }
  }
}

/** First occurrence strictly after `now`, starting from `current` (catch-up without duplicating missed runs). */
export function nextOccurrenceAfter(current: Date, rule: RuleLike, now: Date): Date {
  let next = nextOccurrence(current, rule);
  let guard = 0;
  while (next <= now && guard++ < 10_000) next = nextOccurrence(next, rule);
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
