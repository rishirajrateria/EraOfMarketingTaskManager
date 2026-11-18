import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { RepeatRule } from "@/server/finance/schemas";

/**
 * Repeat rules for recurring bills (ADR 0009), matching the owner's prototype (`nextDate` / `recurText` in
 * docs/prototype/eom-tasks.html). Pure and client-safe: the calendar maths runs on `yyyy-MM-dd` keys (company-timezone
 * calendar days), so DST / UTC offsets never shift a due date.
 *  - DAILY: every `interval` days after the previous due date.
 *  - WEEKDAYS: the next Mon–Fri day.
 *  - WEEKLY: the next listed weekday in a week that is a multiple of `interval` Monday-based weeks from the anchor week.
 *  - MONTHLY: `monthDay` (clamped to the month length, 32 = last day) or the nth weekday (5 = last) every `interval` months
 *    counted from the anchor month.
 *  - YEARLY: `yearDay` of `yearMonth` (clamped, so 29 Feb falls back to 28 Feb) every `interval` years from the anchor year.
 *  - Ends: COUNT stops once `doneCount` payments exist; UNTIL drops dates after `endsUntil`.
 */
export type { RepeatRule } from "@/server/finance/schemas";

const DAY_MS = 86_400_000;
export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const NTH_WORDS = ["first", "second", "third", "fourth", "last"] as const;
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const utc = (key: string) => new Date(`${key}T00:00:00Z`);
const keyOf = (d: Date) => d.toISOString().slice(0, 10);
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Calendar helpers on yyyy-MM-dd keys. */
export const addDaysKey = (key: string, n: number) => keyOf(new Date(utc(key).getTime() + n * DAY_MS));
export const weekdayOfKey = (key: string) => utc(key).getUTCDay();
/** Days in month `m` (1–12) of year `y`. */
export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const mondayOf = (key: string) => addDaysKey(key, -((weekdayOfKey(key) + 6) % 7));
const parts = (key: string) => key.split("-").map(Number) as [number, number, number];

/** "1st", "2nd", "3rd", "11th", "22nd" … */
export function ordinal(n: number): string {
  const s = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${s}`;
}

function monthCandidate(r: RepeatRule, y: number, m: number): string | null {
  const last = daysInMonth(y, m);
  if (r.monthMode === "NTH") {
    if (r.nth >= 5) {
      let d = last;
      while (weekdayOfKey(ymd(y, m, d)) !== r.nthWeekday) d--;
      return ymd(y, m, d);
    }
    let d = 1;
    while (weekdayOfKey(ymd(y, m, d)) !== r.nthWeekday) d++;
    d += 7 * (r.nth - 1);
    return d <= last ? ymd(y, m, d) : null;
  }
  return ymd(y, m, r.monthDay >= 32 ? last : Math.min(r.monthDay, last));
}

/** Next due date (yyyy-MM-dd) strictly after `afterKey`, or null when the rule has ended. */
export function nextDateKey(r: RepeatRule, afterKey: string, doneCount: number): string | null {
  if (r.endsType === "COUNT" && r.endsCount != null && doneCount >= r.endsCount) return null;
  const anchor = r.anchorDate || afterKey;
  const limit = r.endsType === "UNTIL" && r.endsUntil ? r.endsUntil : null;
  const ok = (k: string | null) => (k && (!limit || k <= limit) ? k : null);
  const iv = Math.max(1, r.interval || 1);
  switch (r.freq) {
    case "DAILY":
      return ok(addDaysKey(afterKey, iv));
    case "WEEKDAYS": {
      let k = addDaysKey(afterKey, 1);
      while (weekdayOfKey(k) === 0 || weekdayOfKey(k) === 6) k = addDaysKey(k, 1);
      return ok(k);
    }
    case "WEEKLY": {
      const a = utc(mondayOf(anchor)).getTime();
      for (let n = 1; n <= 7 * iv * 2 + 7; n++) {
        const k = addDaysKey(afterKey, n);
        const w = Math.round((utc(mondayOf(k)).getTime() - a) / (7 * DAY_MS));
        if (w >= 0 && w % iv === 0 && r.weekdays.includes(weekdayOfKey(k))) return ok(k);
      }
      return null;
    }
    default: {
      const [ay, am] = parts(anchor);
      for (let k = 0; k < 400; k++) {
        let d: string | null;
        if (r.freq === "YEARLY") {
          const y = ay + k * iv;
          d = ymd(y, r.yearMonth, Math.min(r.yearDay, daysInMonth(y, r.yearMonth)));
        } else {
          const mm = am - 1 + k * iv;
          d = monthCandidate(r, ay + Math.floor(mm / 12), (mm % 12) + 1);
        }
        if (d && d > afterKey) return ok(d);
      }
      return null;
    }
  }
}

/** `nextDateKey` for instants: `after` is read as a calendar day in `tz`; the result is the start of that day in `tz`. */
export function nextDate(r: RepeatRule, after: Date, doneCount: number, tz = "Asia/Kolkata"): Date | null {
  const key = nextDateKey(r, formatInTimeZone(after, tz, "yyyy-MM-dd"), doneCount);
  return key ? fromZonedTime(`${key}T00:00:00`, tz) : null;
}

/** "09 Oct" (as the prototype's fmtD). */
function shortDay(key: string): string {
  const [, m, d] = parts(key);
  return `${pad(d)} ${MONTH_SHORT[m - 1]}`;
}

/** Human summary: "Every Thu, Fri · 10 times", "Every month on the last day", "Every weekday (Mon–Fri)". */
export function describeRule(r: RepeatRule): string {
  const iv = Math.max(1, r.interval || 1);
  const every = (n: number, unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  let s: string;
  if (r.freq === "DAILY") s = every(iv, "day");
  else if (r.freq === "WEEKDAYS") s = "Every weekday (Mon–Fri)";
  else if (r.freq === "WEEKLY") {
    const days = r.weekdays
      .slice()
      .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
      .map((d) => WEEKDAY_SHORT[d])
      .join(", ");
    s = (iv === 1 ? "Every " : `Every ${iv} weeks on `) + days;
  } else if (r.freq === "MONTHLY") {
    const on = r.monthMode === "DATE" ? (r.monthDay >= 32 ? "last day" : ordinal(r.monthDay)) : `${NTH_WORDS[r.nth - 1]} ${WEEKDAY_SHORT[r.nthWeekday]}`;
    s = `${every(iv, "month")} on the ${on}`;
  } else s = `${iv === 1 ? "Every year" : `Every ${iv} years`} on ${r.yearDay} ${MONTH_SHORT[r.yearMonth - 1]}`;
  if (r.endsType === "COUNT" && r.endsCount) s += ` · ${r.endsCount} times`;
  else if (r.endsType === "UNTIL" && r.endsUntil) s += ` · until ${shortDay(r.endsUntil)}`;
  return s;
}

/** The picker's starting rule for a first due date (prototype `recurPicker` defaults): weekly on that weekday. */
export function defaultRule(baseKey: string): RepeatRule {
  const [, m, d] = parts(baseKey);
  const wd = weekdayOfKey(baseKey);
  return {
    freq: "WEEKLY",
    interval: 1,
    weekdays: [wd],
    monthMode: "DATE",
    monthDay: d,
    nth: Math.min(5, Math.ceil(d / 7)),
    nthWeekday: wd,
    yearMonth: m,
    yearDay: d,
    endsType: "NEVER",
    endsCount: 10,
    endsUntil: null,
    anchorDate: baseKey,
  };
}
