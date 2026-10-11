/**
 * Deadline-only tasks (prototype `deadlineSheet` / `AF.deadline`): a "done by" day with no hours, no start or end time
 * and nothing blocked in anyone's day. Stored as scheduledStart = scheduledEnd = that day's working-day end in the
 * company time zone (so the row turns red once the day is over, like any missed start), allocatedMinutes = 0.
 * "For client" tasks are always deadline only (the "Needed by" day). Pure: no DB access, unit-tested in tests/tasks.
 */
import { dateKey, parseDateKey, zonedDayAt } from "@/lib/time";
import { PAST_DAY_MESSAGE, isDateOnly } from "@/server/tasks/schema";

/** The due instant of a "done by" day: its working-day end (e.g. 19:00) in `tz`. */
export function deadlineInstant(day: string, tz: string, workEndMinutes: number): Date {
  return zonedDayAt(parseDateKey(day, tz), workEndMinutes, tz);
}

/**
 * The "done by" day of a deadline input: a yyyy-MM-dd as is, an ISO instant → its day in `tz`. Throws without a date
 * and for a day before today (in `tz`).
 */
export function deadlineDay(value: string | null | undefined, tz: string, now = new Date(), what = "due date"): string {
  if (!value) throw new Error(`Pick the ${what}`);
  const day = isDateOnly(value) ? value : dateKey(new Date(value), tz);
  if (!isDateOnly(day)) throw new Error(`Pick the ${what}`);
  if (day < dateKey(now, tz)) throw new Error(PAST_DAY_MESSAGE);
  return day;
}

/** Stored scheduling fields of a deadline-only task due on `day`. */
export function deadlineFields(day: string, tz: string, workEndMinutes: number) {
  const due = deadlineInstant(day, tz, workEndMinutes);
  return { scheduledStart: due, scheduledEnd: due, allocatedMinutes: 0, deadlineOnly: true };
}
