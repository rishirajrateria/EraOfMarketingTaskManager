/**
 * Task recurrence ↔ database (SPEC §13, ADR 0010). The calendar math lives in the pure `repeat-rule.ts`; this module
 * maps `RecurrenceRule` rows to repeat rules (legacy rows are mapped on read) and adds the time of day.
 * Invoice schedules use `src/server/finance/recurrence.ts` instead.
 */
import { toZonedTime } from "date-fns-tz";
import type { RecurrenceRule } from "@prisma/client";
import { dateKey, parseDateKey, zonedDayAt } from "@/lib/time";
import { completeRule, dayOfMonth, describeRule, isDateKey, nextDate, weekdayOf, type RepeatRule } from "@/server/tasks/repeat-rule";

type Legacy = Pick<RecurrenceRule, "frequency" | "interval" | "byWeekday" | "endDate">;
type Extended = Pick<RecurrenceRule, "repeatFreq" | "monthDay" | "nthWeek" | "nthWeekday" | "yearMonth" | "yearDay" | "endAfterCount" | "anchorDate">;
export type RuleRecord = Legacy & Partial<Extended>;

/**
 * Row → repeat rule. `fallbackDay` (yyyy-MM-dd, usually the occurrence the next one follows) stands in for the
 * anchor of legacy rows: legacy WEEKLY / CUSTOM keep their weekdays (or the anchor's weekday) and step `interval`
 * weeks; legacy MONTHLY repeats on the fallback day's date — exactly what the old `addWeeks` / `addMonths` did.
 */
export function toRepeatRule(rec: RuleRecord, fallbackDay: string, tz: string): RepeatRule {
  const anchor = isDateKey(rec.anchorDate) ? rec.anchorDate : fallbackDay;
  const ends = rec.endAfterCount ? { ends: "COUNT" as const, count: rec.endAfterCount } : rec.endDate ? { ends: "UNTIL" as const, until: dateKey(rec.endDate, tz) } : { ends: "NEVER" as const };
  const interval = Math.max(1, rec.interval || 1);
  if (rec.repeatFreq) {
    return completeRule(
      {
        freq: rec.repeatFreq,
        interval,
        days: rec.repeatFreq === "WEEKLY" ? rec.byWeekday : [],
        monthMode: rec.nthWeek ? "NTH" : "DATE",
        monthDay: rec.monthDay ?? undefined,
        nth: rec.nthWeek ?? undefined,
        nthDay: rec.nthWeekday ?? undefined,
        yMonth: rec.yearMonth ?? undefined,
        yDay: rec.yearDay ?? undefined,
        anchor,
        ...ends,
      },
      anchor,
    );
  }
  switch (rec.frequency) {
    case "DAILY":
      return completeRule({ freq: "DAILY", interval, anchor, ...ends }, anchor);
    case "MONTHLY":
      return completeRule({ freq: "MONTHLY", interval, monthMode: "DATE", monthDay: dayOfMonth(fallbackDay), anchor, ...ends }, anchor);
    default:
      return completeRule({ freq: "WEEKLY", interval, days: rec.byWeekday.length ? rec.byWeekday : [weekdayOf(anchor)], anchor, ...ends }, anchor);
  }
}

/** Repeat rule → `RecurrenceRule` columns. `frequency` / `byWeekday` keep a coarse legacy-compatible value. */
export function repeatRuleData(r: RepeatRule, tz: string) {
  const weekly = r.freq === "WEEKLY" || r.freq === "WEEKDAYS";
  const monthly = r.freq === "MONTHLY";
  return {
    frequency: r.freq === "DAILY" ? ("DAILY" as const) : weekly ? ("WEEKLY" as const) : ("MONTHLY" as const),
    interval: r.freq === "WEEKDAYS" ? 1 : r.interval,
    byWeekday: r.freq === "WEEKDAYS" ? [1, 2, 3, 4, 5] : r.freq === "WEEKLY" ? [...r.days].sort((a, b) => a - b) : [],
    repeatFreq: r.freq,
    monthDay: monthly && r.monthMode === "DATE" ? r.monthDay : null,
    nthWeek: monthly && r.monthMode === "NTH" ? r.nth : null,
    nthWeekday: monthly && r.monthMode === "NTH" ? r.nthDay : null,
    yearMonth: r.freq === "YEARLY" ? r.yMonth : null,
    yearDay: r.freq === "YEARLY" ? r.yDay : null,
    endAfterCount: r.ends === "COUNT" ? r.count : null,
    endDate: r.ends === "UNTIL" && isDateKey(r.until) ? parseDateKey(r.until, tz) : null,
    anchorDate: r.anchor ?? null,
  };
}

/**
 * Due time of the occurrence after the one at `after`: the next repeat day (company tz) at the same time of day.
 * `doneCount` = occurrences that already exist (for "After N times"). Null once the rule has ended.
 */
export function nextRunAt(rule: RuleRecord, after: Date, tz = "Asia/Kolkata", doneCount = 0): Date | null {
  const afterDay = dateKey(after, tz);
  const day = nextDate(toRepeatRule(rule, afterDay, tz), afterDay, doneCount);
  if (!day) return null;
  const local = toZonedTime(after, tz);
  return zonedDayAt(parseDateKey(day, tz), local.getHours() * 60 + local.getMinutes(), tz);
}

/** "Every Fri · 10 times" for a stored rule (task detail). */
export function describeRecord(rule: RuleRecord, firstStart: Date | null, tz: string): string {
  return describeRule(toRepeatRule(rule, dateKey(firstStart ?? new Date(), tz), tz));
}
