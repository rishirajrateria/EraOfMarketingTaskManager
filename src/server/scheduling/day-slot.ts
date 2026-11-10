/**
 * "Date only" starts (ADR 0010 addendum): the add-task sheet may pick a day without a time, meaning "the next free time
 * on that day" for the people the task lands on. Built on the same busy data and `findSlot` as "Up next", bound to one
 * day; a day with no room falls back to the next free slot from that day onward — day by day, as Up next would place
 * it — and says why, so the UI can tell the user instead of dropping the request.
 */
import { addDays } from "date-fns";
import { dateKey, parseDateKey } from "@/lib/time";
import { minutesBetween, type Interval } from "@/lib/working-time";
import { addKeyDays } from "@/server/availability/day-status";
import { PAST_DAY_MESSAGE } from "@/server/tasks/schema";
import { freeMinutesOn, freeOn, findAvailableSlot, slotDays, type SlotDays } from "@/server/scheduling/finder";
import { ceilToMinute, collectBusy, proposeSlot, workingConfig, type BusyOptions, type SlotProposal } from "@/server/scheduling/slot";

export { PAST_DAY_MESSAGE };

/**
 * Why a date-only start did not land on its day: no working hours at all (weekend, holiday, everyone on leave), today
 * after hours, every working minute taken, or some free time but less than the task needs.
 */
export type DayMissed = "day-off" | "over" | "full" | "no-room";

/** Where a date-only start ended up — sent back to the client for the toast / preview caption. */
export type DayPlacement = {
  /** The yyyy-MM-dd the user asked for (company time zone; meetings: the meeting's zone). */
  requestedDay: string;
  /** The slot starts on that day. */
  onRequestedDay: boolean;
  /** When it does not: why. Null when it does. */
  missed: DayMissed | null;
  /** Working minutes still free on the requested day (from now when it is today) — "has only 1h free". */
  freeMinutes: number;
};

export type DaySlotResult = { slot: SlotProposal } & DayPlacement;

const HORIZON_DAYS = 60;
type DaySlotOptions = BusyOptions & {
  /** The zone the day key is read in (default: the company zone). Meetings pass their own zone. */
  dayZone?: string;
};

/** "2026-10-31" + 1 → "2026-11-01": calendar arithmetic on the key itself (no zone, no DST). */
export const shiftDayKey = addKeyDays;

/**
 * Minutes in [from, to) the assignees can work, over the company days the window touches: with `busy` (and capped by
 * the capacity left per day) it is the free time; with no busy blocks and `capped` false it is the raw working window.
 */
function minutesBetweenIn(from: Date, to: Date, tz: string, days: SlotDays, busy: Interval[], capped: boolean): number {
  let total = 0;
  const last = dateKey(new Date(to.getTime() - 1), tz);
  for (let key = dateKey(from, tz), i = 0; key <= last && i < 400; key = addKeyDays(key, 1), i++) {
    total += capped
      ? freeMinutesOn(days, key, busy, from, to)
      : freeOn(days, key, busy, from, to).reduce((s, iv) => s + minutesBetween(iv.start, iv.end), 0);
  }
  return total;
}

/**
 * Next free slot on `day` (yyyy-MM-dd) for all `assigneeIds`: within everyone's availability (`personDayStatus`: lunch,
 * holidays, approved leave, weekly offs, absent / half days and per-person capacity honoured), after their existing active tasks and calendar busy blocks, never in the past when the day
 * is today. The day is read in `opts.dayZone` (meetings: the meeting's zone; a day there may straddle two company
 * days), the working hours stay the company's. Like the prototype's `dayFreeSlot`, the first gap where the WHOLE
 * duration fits wins; only when no single gap is long enough (a task longer than a lunch-bounded block) may it be
 * split across that day's free time, as "Up next" does. No room on that day → the same search on each following day
 * (60 days): the next day it fits on, whole or split, as "Up next" would place it — never a contiguous gap weeks
 * later over a nearer split; a task longer than any day → the usual "Up next" proposal from that day (split across
 * days, then overlapping subordinates' self-assigned blocks). `onRequestedDay` says whether the start is on that day
 * (it may still be, from the last resort), `missed` why not. The day pass itself never displaces anyone. Throws for a
 * day before today; null when nothing fits.
 */
export async function proposeSlotOnDay(assigneeIds: string[], minutes: number, day: string, opts: DaySlotOptions, now = new Date()): Promise<DaySlotResult | null> {
  const cfg = await workingConfig();
  const zone = opts.dayZone || cfg.timezone;
  if (day < dateKey(now, zone)) throw new Error(PAST_DAY_MESSAGE);
  const dayStart = parseDateKey(day, zone);
  const dayEnd = parseDateKey(shiftDayKey(day, 1), zone);
  const from = ceilToMinute(dayStart > now ? dayStart : now);
  const { hard, soft, world } = await collectBusy(assigneeIds, from, addDays(from, HORIZON_DAYS + 1), opts, cfg);
  const busy = [...hard, ...soft]; // strict: soft blocks are honoured
  const days = slotDays(world, assigneeIds);
  const tz = cfg.timezone;

  // Why the day may not do: nothing to work in at all / nothing left of today / every minute taken / too little.
  const freeMinutes = minutesBetweenIn(from, dayEnd, tz, days, busy, true);
  const missed: DayMissed =
    minutesBetweenIn(dayStart, dayEnd, tz, days, [], false) === 0 ? "day-off" : minutesBetweenIn(from, dayEnd, tz, days, [], false) === 0 ? "over" : freeMinutes === 0 ? "full" : "no-room";
  const placement = (hit: boolean): DayPlacement => ({ requestedDay: day, onRequestedDay: hit, missed: hit ? null : missed, freeMinutes });

  // One calendar day in `zone`: a whole contiguous gap first, else split across that day's free time.
  const onDay = (key: string) => {
    const start = parseDateKey(key, zone);
    const end = parseDateKey(shiftDayKey(key, 1), zone);
    const f = start > from ? start : from;
    const o = { maxDays: 3, until: end }; // a zone day touches at most two (DST: three) company days
    return findAvailableSlot(f, minutes, cfg, busy, days, { ...o, allowSplit: false }) ?? findAvailableSlot(f, minutes, cfg, busy, days, { ...o, allowSplit: true });
  };
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const found = onDay(shiftDayKey(day, i));
    if (found) return { slot: { ...found, displaced: [] }, ...placement(i === 0) };
  }
  const usual = await proposeSlot(assigneeIds, minutes, { ...opts, from });
  return usual ? { slot: usual, ...placement(dateKey(usual.start, zone) === day) } : null;
}
