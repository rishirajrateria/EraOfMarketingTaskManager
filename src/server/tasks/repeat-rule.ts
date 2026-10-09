/**
 * Task repeat rules (ADR 0010) — pure calendar math, no I/O, safe to import from client components.
 * Mirrors the owner's prototype (`recurText`, `nextDate`, `recurPicker` in docs/prototype/eom-tasks.html).
 *
 * Every date is a `yyyy-MM-dd` key of a calendar day in the company timezone (Asia/Kolkata); the time of day is
 * handled by the caller (`src/server/tasks/recurrence.ts`). Internally keys are mapped to UTC midnights so the
 * arithmetic never depends on the host timezone.
 */

export type RepeatFreq = "DAILY" | "WEEKDAYS" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type RepeatEnds = "NEVER" | "COUNT" | "UNTIL";

export type RepeatRule = {
  freq: RepeatFreq;
  /** every N days / weeks / months / years (WEEKDAYS ignores it) */
  interval: number;
  /** WEEKLY: weekdays, 0 = Sunday … 6 = Saturday */
  days: number[];
  /** MONTHLY: on a date (`monthDay`) or on "the first … last <weekday>" (`nth` + `nthDay`) */
  monthMode: "DATE" | "NTH";
  /** 1–31, 32 = last day of the month (shorter months clamp to their last day) */
  monthDay: number;
  /** 1–4 = first … fourth, 5 = last */
  nth: number;
  nthDay: number;
  /** YEARLY: month 0–11 and day 1–31 (clamped, so 29 Feb falls on 28 Feb in other years) */
  yMonth: number;
  yDay: number;
  ends: RepeatEnds;
  /** total occurrences including the first, when ends = COUNT */
  count: number;
  /** last allowed day (inclusive), when ends = UNTIL */
  until: string;
  /** day of the first occurrence; weekly / monthly / yearly intervals are counted from it */
  anchor?: string;
};

export const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const NTH = ["first", "second", "third", "fourth", "last"] as const;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const DAY_MS = 86_400_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---------- date-key arithmetic (UTC midnights) ----------

export function isDateKey(s: string | null | undefined): s is string {
  return !!s && KEY_RE.test(s);
}

function toUtc(key: string): Date {
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`Bad date key: ${key}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function fromUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

const ymd = (y: number, m: number, d: number) => fromUtc(new Date(Date.UTC(y, m, d)));
export const addDaysKey = (key: string, n: number) => fromUtc(new Date(toUtc(key).getTime() + n * DAY_MS));
export const weekdayOf = (key: string) => toUtc(key).getUTCDay();
export const dayOfMonth = (key: string) => toUtc(key).getUTCDate();
export const monthOf = (key: string) => toUtc(key).getUTCMonth();
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** Monday of the key's week (weeks start on Monday). */
const mondayOf = (key: string) => addDaysKey(key, -((weekdayOf(key) + 6) % 7));
const weeksBetween = (a: string, b: string) => Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / (7 * DAY_MS));

// ---------- rules ----------

/** Default rule for the picker: weekly on the base day's weekday, never ends (prototype `recurPicker`). */
export function defaultRule(base: string): RepeatRule {
  const wd = weekdayOf(base);
  const md = dayOfMonth(base);
  return { freq: "WEEKLY", interval: 1, days: [wd], monthMode: "DATE", monthDay: md, nth: Math.min(5, Math.ceil(md / 7)), nthDay: wd, yMonth: monthOf(base), yDay: md, ends: "NEVER", count: 10, until: "" };
}

/** Fill whatever a (possibly partial / legacy) rule leaves out from the day of its first occurrence. */
export function completeRule(r: Partial<RepeatRule> & Pick<RepeatRule, "freq">, base: string): RepeatRule {
  const d = defaultRule(base);
  const out: RepeatRule = { ...d, ...stripUndefined(r) };
  out.interval = Math.max(1, Math.round(out.interval || 1));
  if (!out.days.length) out.days = d.days;
  if (out.ends === "UNTIL" && !isDateKey(out.until)) out.ends = "NEVER";
  return out;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

export const ordinal = (n: number) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

/** "09 Oct" — the prototype's `fmtD` (en-IN, 2-digit day, short month). */
const fmtDay = (key: string) => `${String(dayOfMonth(key)).padStart(2, "0")} ${MON[monthOf(key)]}`;

/** Human summary, e.g. "Every 2 weeks on Mon, Fri · until 31 Dec" (prototype `recurText`). */
export function describeRule(r: RepeatRule): string {
  const n = Math.max(1, r.interval || 1);
  const every = (unit: string) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  let s: string;
  if (r.freq === "DAILY") s = every("day");
  else if (r.freq === "WEEKDAYS") s = "Every weekday (Mon–Fri)";
  else if (r.freq === "WEEKLY") {
    const days = [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WD[d]);
    s = (n === 1 ? "Every " : `Every ${n} weeks on `) + days.join(", ");
  } else if (r.freq === "MONTHLY") {
    const on = r.monthMode === "DATE" ? (r.monthDay === 32 ? "last day" : ordinal(r.monthDay)) : `${NTH[r.nth - 1]} ${WD[r.nthDay]}`;
    s = `${every("month")} on the ${on}`;
  } else s = `${n === 1 ? "Every year" : `Every ${n} years`} on ${r.yDay} ${MON[r.yMonth]}`;
  if (r.ends === "COUNT") s += ` · ${r.count} times`;
  else if (r.ends === "UNTIL" && isDateKey(r.until)) s += ` · until ${fmtDay(r.until)}`;
  return s;
}

/** Quick-pick presets for a base day (prototype `recurPicker`). */
export function repeatPresets(base: string): { label: string; patch: Partial<RepeatRule> }[] {
  const wd = weekdayOf(base);
  const md = dayOfMonth(base);
  return [
    { label: "Every day", patch: { freq: "DAILY", interval: 1 } },
    { label: "Every weekday", patch: { freq: "WEEKDAYS", interval: 1 } },
    { label: `Every ${WD[wd]}`, patch: { freq: "WEEKLY", interval: 1, days: [wd] } },
    { label: "Every 2 weeks", patch: { freq: "WEEKLY", interval: 2, days: [wd] } },
    { label: `Every month on the ${ordinal(md)}`, patch: { freq: "MONTHLY", interval: 1, monthMode: "DATE", monthDay: md } },
    { label: "Every month, last day", patch: { freq: "MONTHLY", interval: 1, monthMode: "DATE", monthDay: 32 } },
    { label: "Every 3 months", patch: { freq: "MONTHLY", interval: 3, monthMode: "DATE", monthDay: md } },
    { label: "Every year", patch: { freq: "YEARLY", interval: 1 } },
  ];
}

/** A preset is "on" when applying it would not change the summary (prototype behaviour). */
export const presetActive = (r: RepeatRule, patch: Partial<RepeatRule>) => describeRule({ ...r, ...patch }) === describeRule(r);

/** Day of `nth` (1–4, 5 = last) `weekday` in month `m` of year `y`; null when the month has no such day. */
function nthWeekday(y: number, m: number, nth: number, weekday: number): string | null {
  if (nth >= 5) {
    let d = ymd(y, m, lastDay(y, m));
    while (weekdayOf(d) !== weekday) d = addDaysKey(d, -1);
    return d;
  }
  let d = ymd(y, m, 1);
  while (weekdayOf(d) !== weekday) d = addDaysKey(d, 1);
  d = addDaysKey(d, 7 * (nth - 1));
  return monthOf(d) === m ? d : null;
}

/**
 * The next occurrence strictly after `after` (a day key), or null when the rule has ended.
 * `doneCount` = occurrences that already exist (the first one included), for "After N times".
 */
export function nextDate(r: RepeatRule, after: string, doneCount = 0): string | null {
  if (r.ends === "COUNT" && doneCount >= r.count) return null;
  const anchor = isDateKey(r.anchor) ? r.anchor : after;
  const limit = r.ends === "UNTIL" && isDateKey(r.until) ? r.until : null;
  const ok = (d: string | null) => (d && (!limit || d <= limit) ? d : null);
  const n = Math.max(1, r.interval || 1);

  if (r.freq === "DAILY") return ok(addDaysKey(after, n));
  if (r.freq === "WEEKDAYS") {
    let d = addDaysKey(after, 1);
    while (weekdayOf(d) === 0 || weekdayOf(d) === 6) d = addDaysKey(d, 1);
    return ok(d);
  }
  if (r.freq === "WEEKLY") {
    const days = r.days.length ? r.days : [weekdayOf(anchor)];
    const a = mondayOf(anchor);
    for (let i = 1; i <= 7 * n * 2 + 7; i++) {
      const d = addDaysKey(after, i);
      const w = weeksBetween(a, mondayOf(d));
      if (w >= 0 && w % n === 0 && days.includes(weekdayOf(d))) return ok(d);
    }
    return null;
  }

  const ay = toUtc(anchor).getUTCFullYear();
  const am = monthOf(anchor);
  const candidate = (y: number, m: number): string | null => {
    if (r.freq === "YEARLY") return ymd(y, r.yMonth, Math.min(r.yDay, lastDay(y, r.yMonth)));
    if (r.monthMode === "NTH") return nthWeekday(y, m, r.nth, r.nthDay);
    return ymd(y, m, r.monthDay === 32 ? lastDay(y, m) : Math.min(r.monthDay, lastDay(y, m)));
  };
  for (let k = 0; k < 400; k++) {
    let d: string | null;
    if (r.freq === "YEARLY") d = candidate(ay + k * n, 0);
    else {
      const mm = am + k * n;
      d = candidate(ay + Math.floor(mm / 12), ((mm % 12) + 12) % 12);
    }
    if (d && d > after) return ok(d);
  }
  return null;
}
