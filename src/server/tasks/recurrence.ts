/** Pure recurrence math for tasks (SPEC §13) and invoices. */
import { addDays, addMonths, addWeeks } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { RecurrenceRule } from "@prisma/client";

type Rule = Pick<RecurrenceRule, "frequency" | "interval" | "byWeekday" | "endDate">;

/** Next occurrence strictly after `after`, honouring byWeekday for WEEKLY/CUSTOM. Null if past endDate. */
export function nextRunAt(rule: Rule, after: Date, tz = "Asia/Kolkata"): Date | null {
  let next: Date;
  switch (rule.frequency) {
    case "DAILY":
      next = addDays(after, rule.interval);
      break;
    case "WEEKLY":
    case "CUSTOM": {
      if (rule.byWeekday.length === 0) {
        next = addWeeks(after, rule.interval);
        break;
      }
      // step day by day until a matching weekday (in company tz), at most interval*7+7 days
      next = addDays(after, 1);
      for (let i = 0; i < rule.interval * 7 + 7; i++) {
        if (rule.byWeekday.includes(toZonedTime(next, tz).getDay())) break;
        next = addDays(next, 1);
      }
      break;
    }
    case "MONTHLY":
      next = addMonths(after, rule.interval);
      break;
  }
  if (rule.endDate && next > addDays(rule.endDate, 1)) return null;
  return next;
}
