/**
 * The slot finder's day model (ADR 0019): free time = the INTERSECTION of every assignee's `personDayStatus` window
 * on that day, minus busy blocks, limited by the smallest capacity left (capacity − booked work) among them.
 * Same inputs as inventory, so "Up next" can never place work where the Inventory page says there is no room.
 */
import { dateKey } from "@/lib/time";
import { minutesBetween, subtractIntervals, type Interval, type WorkingConfig } from "@/lib/working-time";
import { addKeyDays, intersectIntervals } from "@/server/availability/day-status";
import type { World } from "@/server/availability/booked";

export type SlotDays = {
  /** Time every assignee is available on `key` (lunch and off time excluded). */
  windowOn(key: string): Interval[];
  /** Minutes of work still bookable on `key`: the smallest (capacity − booked) among the assignees. */
  capacityLeft(key: string): number;
};

/** `exclude`: booked tasks to ignore (soft-blocked tasks a superior may displace). */
export function slotDays(world: World, ids: string[], exclude: ReadonlySet<string> = new Set()): SlotDays {
  const booked = new Map<string, number>();
  for (const b of world.booked) {
    if (exclude.has(b.taskId)) continue;
    booked.set(`${b.userId}|${b.day}`, (booked.get(`${b.userId}|${b.day}`) ?? 0) + b.minutes);
  }
  return {
    windowOn(key) {
      let win: Interval[] | null = null;
      for (const id of ids) {
        const w = world.availability.day(id, key).window;
        win = win ? intersectIntervals(win, w) : w;
      }
      return win ?? [];
    },
    capacityLeft(key) {
      let left = Infinity;
      for (const id of ids) left = Math.min(left, world.availability.day(id, key).capacityMinutes - (booked.get(`${id}|${key}`) ?? 0));
      return left === Infinity ? 0 : Math.max(0, left);
    },
  };
}

/** Free intervals of one day: window − busy, clipped to [from, until). */
export function freeOn(days: SlotDays, key: string, busy: Interval[], from: Date, until?: Date): Interval[] {
  return subtractIntervals(days.windowOn(key), busy)
    .map((iv) => ({ start: iv.start > from ? iv.start : from, end: until && iv.end > until ? until : iv.end }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Free minutes on one day, capped by the capacity left. */
export function freeMinutesOn(days: SlotDays, key: string, busy: Interval[], from: Date, until?: Date): number {
  const free = freeOn(days, key, busy, from, until).reduce((s, iv) => s + minutesBetween(iv.start, iv.end), 0);
  return Math.min(free, days.capacityLeft(key));
}

/**
 * First place for `minutes` of work at/after `from`. Without `allowSplit`: one contiguous gap on one day. With it,
 * the minutes may be spread over a day's gaps and over following days — never more than a day's capacity left.
 * `until` clips the search (a day-bound search).
 */
export function findAvailableSlot(
  from: Date,
  minutes: number,
  cfg: Pick<WorkingConfig, "timezone">,
  busy: Interval[],
  days: SlotDays,
  opts: { maxDays?: number; allowSplit?: boolean; until?: Date } = {},
): { start: Date; end: Date; chunks: Interval[] } | null {
  const maxDays = opts.maxDays ?? 90;
  const allowSplit = opts.allowSplit ?? true;
  const chunks: Interval[] = [];
  let remaining = minutes;
  let key = dateKey(from, cfg.timezone);
  for (let i = 0; i < maxDays; i++, key = addKeyDays(key, 1)) {
    let cap = days.capacityLeft(key);
    if (cap <= 0) continue;
    for (const iv of freeOn(days, key, busy, from, opts.until)) {
      const len = minutesBetween(iv.start, iv.end);
      if (!allowSplit) {
        if (len >= minutes && cap >= minutes) {
          const end = new Date(iv.start.getTime() + minutes * 60_000);
          return { start: iv.start, end, chunks: [{ start: iv.start, end }] };
        }
        continue;
      }
      const take = Math.min(len, remaining, cap);
      if (take <= 0) continue;
      const end = new Date(iv.start.getTime() + take * 60_000);
      chunks.push({ start: iv.start, end });
      remaining -= take;
      cap -= take;
      if (remaining <= 0) return { start: chunks[0].start, end, chunks };
    }
  }
  return null;
}
