/**
 * "Date only" starts (ADR 0010 addendum): the add-task sheet may pick a day without a time, meaning "the next free time
 * on that day" for the people the task lands on. Built on the same busy data and `findSlot` as "Up next", bound to one
 * day; a full day falls back to the next free slot from that day onward and says so, so the UI can tell the user instead
 * of dropping the request.
 */
import { addDays } from "date-fns";
import { dateKey, parseDateKey } from "@/lib/time";
import { findSlot, isWorkingDay } from "@/lib/working-time";
import { ceilToMinute, collectBusy, proposeSlot, workingConfig, type BusyOptions, type SlotProposal } from "@/server/scheduling/slot";

/** Where a date-only start ended up — sent back to the client for the toast / preview caption. */
export type DayPlacement = {
  /** The yyyy-MM-dd the user asked for (company time zone). */
  requestedDay: string;
  /** The slot starts on that day. */
  onRequestedDay: boolean;
  /** The requested day has no working hours at all (weekend / holiday) — "day off", not "full". */
  requestedDayOff: boolean;
};

export type DaySlotResult = { slot: SlotProposal } & DayPlacement;

export const PAST_DAY_MESSAGE = "That day has passed — pick today or later";
const HORIZON_DAYS = 60;

/**
 * Next free slot on `day` (yyyy-MM-dd, company time zone) for all `assigneeIds`: within working hours (lunch, holidays
 * and approved leave excluded), after their existing active tasks and calendar busy blocks, never in the past when the
 * day is today. Like the prototype's `dayFreeSlot`, the first gap where the WHOLE duration fits wins; only when no
 * single gap is long enough (a task longer than a lunch-bounded block) may it be split across that day's free time, as
 * "Up next" does. Nothing on that day → the next contiguous gap from that day onward (60 days), else the usual
 * "Up next" proposal from that day (split, then overlapping subordinates' self-assigned blocks); `onRequestedDay` is
 * then false. The day pass itself never displaces anyone. Throws for a day before today; null when nothing fits.
 */
export async function proposeSlotOnDay(assigneeIds: string[], minutes: number, day: string, opts: BusyOptions, now = new Date()): Promise<DaySlotResult | null> {
  const cfg = await workingConfig();
  const tz = cfg.timezone;
  if (day < dateKey(now, tz)) throw new Error(PAST_DAY_MESSAGE);
  const dayStart = parseDateKey(day, tz);
  const from = ceilToMinute(dayStart > now ? dayStart : now);
  const placement = { requestedDay: day, requestedDayOff: !isWorkingDay(dayStart, cfg) };
  const { hard, soft, off } = await collectBusy(assigneeIds, from, addDays(from, HORIZON_DAYS), opts, tz);
  const busy = [...hard, ...soft]; // strict: soft blocks are honoured
  const find = (maxDays: number, allowSplit: boolean) => findSlot(from, minutes, cfg, busy, { extraOff: off, maxDays, allowSplit });
  const same = find(1, false) ?? find(1, true);
  if (same && dateKey(same.start, tz) === day) return { slot: { ...same, displaced: [] }, ...placement, onRequestedDay: true };
  const later = find(HORIZON_DAYS, false);
  if (later) return { slot: { ...later, displaced: [] }, ...placement, onRequestedDay: false };
  const usual = await proposeSlot(assigneeIds, minutes, { ...opts, from });
  return usual ? { slot: usual, ...placement, onRequestedDay: false } : null;
}
