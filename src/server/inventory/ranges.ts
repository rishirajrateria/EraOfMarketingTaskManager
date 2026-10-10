/**
 * Pure calendar helpers for the inventory views (SPEC §9.3): Day / Week / Month / Quarter / Year / Custom.
 * Everything works on yyyy-MM-dd keys (already in the company timezone), so no timezone maths is needed here.
 * Quarter = calendar quarter (Jan–Mar, …); Year = Indian financial year (1 April – 31 March).
 */
export type InventoryView = "day" | "week" | "month" | "quarter" | "year" | "custom";
export const INVENTORY_VIEWS: { id: InventoryView; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
  { id: "custom", label: "Custom" },
];

export const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isInventoryView(v: string | undefined): v is InventoryView {
  return INVENTORY_VIEWS.some((x) => x.id === v);
}

export type KeyRange = { from: string; to: string; label: string };
/** Granularity of the "remaining" strip: Quarter is bucketed per week and Year per month so it stays readable. */
export type StripGranularity = "day" | "week" | "month";

const pad = (n: number) => String(n).padStart(2, "0");
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const toKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parts = (key: string) => key.split("-").map(Number) as [number, number, number];

export function addDaysKey(key: string, n: number): string {
  const [y, m, d] = parts(key);
  return toKey(utc(y, m - 1, d + n));
}

function addMonthsKey(key: string, n: number): string {
  const [y, m, d] = parts(key);
  const first = utc(y, m - 1 + n, 1);
  const lastDay = utc(first.getUTCFullYear(), first.getUTCMonth() + 1, 0).getUTCDate();
  return toKey(utc(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, lastDay)));
}

/** Monday of the week containing `key`. */
export function weekStartKey(key: string): string {
  const [y, m, d] = parts(key);
  const dow = utc(y, m - 1, d).getUTCDay(); // 0 = Sunday
  return addDaysKey(key, dow === 0 ? -6 : 1 - dow);
}

export function monthStartKey(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

function monthEndKey(key: string): string {
  const [y, m] = parts(key);
  return toKey(utc(y, m, 0));
}

function quarterStartKey(key: string): string {
  const [y, m] = parts(key);
  return toKey(utc(y, Math.floor((m - 1) / 3) * 3, 1));
}

/** 1 April of the financial year containing `key`. */
export function financialYearStartKey(key: string): string {
  const [y, m] = parts(key);
  return `${m >= 4 ? y : y - 1}-04-01`;
}

const dayLabel = (key: string) => {
  const [y, m, d] = parts(key);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][utc(y, m - 1, d).getUTCDay()];
  return `${wd} ${d} ${MONTHS[m - 1]} ${y}`;
};
const shortLabel = (key: string) => {
  const [, m, d] = parts(key);
  return `${d} ${MONTHS[m - 1]}`;
};

/** Range and human label for a view anchored on `key` (any day inside the period). */
export function periodRange(view: Exclude<InventoryView, "custom">, key: string): KeyRange {
  switch (view) {
    case "day":
      return { from: key, to: key, label: dayLabel(key) };
    case "week": {
      const from = weekStartKey(key);
      const to = addDaysKey(from, 6);
      return { from, to, label: `${shortLabel(from)} – ${shortLabel(to)} ${to.slice(0, 4)}` };
    }
    case "month": {
      const [y, m] = parts(key);
      return { from: monthStartKey(key), to: monthEndKey(key), label: `${MONTHS[m - 1]} ${y}` };
    }
    case "quarter": {
      const from = quarterStartKey(key);
      const to = monthEndKey(addMonthsKey(from, 2));
      const [y, m] = parts(from);
      return { from, to, label: `Q${Math.floor((m - 1) / 3) + 1} ${y} (${MONTHS[m - 1]}–${MONTHS[m + 1]})` };
    }
    case "year": {
      const from = financialYearStartKey(key);
      const to = addDaysKey(addMonthsKey(from, 12), -1);
      const y = parts(from)[0];
      return { from, to, label: `FY ${y}–${String(y + 1).slice(2)} (Apr–Mar)` };
    }
  }
}

/** Custom range from query params, falling back to the week starting at `todayKey`. */
export function customRange(from: string | undefined, to: string | undefined, todayKey: string): KeyRange {
  const ok = from && to && DAY_KEY_RE.test(from) && DAY_KEY_RE.test(to) && from <= to;
  const f = ok ? from : todayKey;
  const t = ok ? to : addDaysKey(todayKey, 6);
  return { from: f, to: t, label: `${shortLabel(f)} – ${shortLabel(t)} ${t.slice(0, 4)}` };
}

/** Anchor for the previous/next period (custom ranges slide by their own length). */
export function shiftRange(view: InventoryView, range: { from: string; to: string }, dir: 1 | -1): { from: string; to: string } {
  const anchor = range.from;
  switch (view) {
    case "day":
      return periodRange("day", addDaysKey(anchor, dir));
    case "week":
      return periodRange("week", addDaysKey(anchor, 7 * dir));
    case "month":
      return periodRange("month", addMonthsKey(monthStartKey(anchor), dir));
    case "quarter":
      return periodRange("quarter", addMonthsKey(quarterStartKey(anchor), 3 * dir));
    case "year":
      return periodRange("year", addMonthsKey(financialYearStartKey(anchor), 12 * dir));
    case "custom": {
      const len = daysBetweenKeys(range.from, range.to) + 1;
      return { from: addDaysKey(range.from, len * dir), to: addDaysKey(range.to, len * dir) };
    }
  }
}

export function daysBetweenKeys(a: string, b: string): number {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return Math.round((utc(y2, m2 - 1, d2).getTime() - utc(y1, m1 - 1, d1).getTime()) / 86_400_000);
}

export function stripGranularity(view: InventoryView, days: number): StripGranularity {
  if (view === "year") return "month";
  if (view === "quarter") return "week";
  if (view === "custom") return days > 120 ? "month" : days > 35 ? "week" : "day";
  return "day";
}

export type StripBucket<T> = { key: string; label: string; from: string; to: string; items: T[] };

/** Group per-day items into day / week / month buckets (in order) for the "remaining" strip. */
export function bucketByPeriod<T extends { date: string }>(items: T[], by: StripGranularity): StripBucket<T>[] {
  const buckets = new Map<string, StripBucket<T>>();
  for (const item of items) {
    const key = by === "day" ? item.date : by === "week" ? weekStartKey(item.date) : monthStartKey(item.date);
    let b = buckets.get(key);
    if (!b) {
      const [y, m, d] = parts(key);
      const label = by === "day" ? `${pad(d)}/${pad(m)}` : by === "week" ? `${d} ${MONTHS[m - 1]}` : `${MONTHS[m - 1]} ${String(y).slice(2)}`;
      b = { key, label, from: item.date, to: item.date, items: [] };
      buckets.set(key, b);
    }
    if (item.date < b.from) b.from = item.date;
    if (item.date > b.to) b.to = item.date;
    b.items.push(item);
  }
  return Array.from(buckets.values()).sort((a, b) => (a.key < b.key ? -1 : 1));
}
