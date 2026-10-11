import { fmtDate, parseDateKey } from "@/lib/time";
import { fyRange } from "@/server/finance/tds";
import { PERIOD_LABEL, type Period } from "@/server/dashboards/params";

/**
 * The WHEN row of the Admin dashboards (ADR 0016), in the company timezone:
 * This month · Last month · 3 months (this month and the two before) · This FY (Indian FY from 1 April to the end of
 * this month). `end` is exclusive.
 */
export type DashRange = { start: Date; end: Date; fromKey: string; toKey: string; label: string; detail: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10" + n months → "2027-01". */
export function addMonthKey(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export const monthShort = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];
export const monthLong = (month: string) => `${monthShort(month)} ${month.slice(0, 4)}`;

const dayBefore = (key: string) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export function dashRange(period: Period, now: Date, tz: string): DashRange {
  const thisMonth = fmtDate(now, tz, "yyyy-MM");
  const next = addMonthKey(thisMonth, 1);
  let from: string;
  let detail: string;
  if (period === "LAST") {
    from = addMonthKey(thisMonth, -1);
    detail = monthLong(from);
  } else if (period === "QUARTER") {
    from = addMonthKey(thisMonth, -2);
    detail = `${monthShort(from)} – ${monthShort(thisMonth)}`;
  } else if (period === "FY") {
    const fy = fyRange(now, tz);
    from = fmtDate(fy.start, tz, "yyyy-MM");
    detail = `FY ${fy.key}`;
  } else {
    from = thisMonth;
    detail = monthLong(thisMonth);
  }
  const toMonth = period === "LAST" ? thisMonth : next;
  const fromKey = `${from}-01`;
  const endKey = `${toMonth}-01`;
  return { start: parseDateKey(fromKey, tz), end: parseDateKey(endKey, tz), fromKey, toKey: dayBefore(endKey), label: PERIOD_LABEL[period], detail };
}

/** The last `n` months ending with this one, oldest first ("2026-05" … "2026-10"). */
export function lastMonths(now: Date, tz: string, n = 6): string[] {
  const thisMonth = fmtDate(now, tz, "yyyy-MM");
  return Array.from({ length: n }, (_, i) => addMonthKey(thisMonth, i - (n - 1)));
}
