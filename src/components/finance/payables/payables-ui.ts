/** Client-safe helpers for the payables screens (ADR 0009, prototype `PAGES.expenses`). No server imports. */
import type { BillRow, OccRow } from "@/server/finance/payables-queries";
import { MONTH_SHORT } from "@/server/finance/repeat";

export const METHODS: [string, string][] = [
  ["CASH", "Cash"],
  ["UPI", "UPI"],
  ["BANK", "Bank transfer"],
  ["CARD", "Card"],
  ["CHEQUE", "Cheque"],
];
export const methodLabel = (m: string | null) => METHODS.find(([k]) => k === m)?.[1] ?? "—";

export const TIMING: Record<string, [string, string]> = {
  PREPAID: ["Prepaid", "Paid before you get the service"],
  POSTPAID: ["Postpaid", "Bill comes after the service"],
  ADVANCE: ["Advance", "Paid ahead, adjusted against later work"],
};

export const REMIND_OPTIONS: [number, string][] = [
  [0, "On the day"],
  [1, "1 day before"],
  [3, "3 days before"],
  [7, "1 week before"],
];

export type Item = { bill: BillRow; occ: OccRow };

const DAY = 86_400_000;
/** Whole days from `today` to `key` (both yyyy-MM-dd). Negative = in the past. */
export const dayOff = (key: string, today: string) => Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
export const isOver = (o: OccRow, today: string) => o.status === "DUE" && o.dueKey < today;

export function dueWords(o: OccRow, today: string): string {
  const n = dayOff(o.dueKey, today);
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} overdue`;
  if (n === 0) return "due today";
  if (n === 1) return "due tomorrow";
  return `due in ${n} days`;
}

export const planText = (b: BillRow) => (b.plan === "RECURRING" && b.ruleText ? `⟳ ${b.ruleText}` : b.plan === "PART" ? `${b.occurrences.filter((o) => !o.label?.startsWith("Balance of ")).length} parts` : "One time");

/** "09 Oct" / "09 Oct 2026" from a yyyy-MM-dd key. */
export function dShort(key: string | null): string {
  if (!key) return "—";
  const [, m, d] = key.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTH_SHORT[m - 1]}`;
}
export function dLong(key: string | null): string {
  return key ? `${dShort(key)} ${key.slice(0, 4)}` : "—";
}

/** "October 2026" for a yyyy-MM key. */
export function monthLong(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "₹25,000" — whole rupees with Indian grouping (as the prototype's inr), paise when present. */
export function inr(n: number): string {
  const v = Math.round((n + Number.EPSILON) * 100) / 100;
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export const allItems = (bills: BillRow[]): Item[] => bills.flatMap((bill) => bill.occurrences.map((occ) => ({ bill, occ })));

/** Auto GST when the bill includes GST: amount × rate / (100 + rate), rounded to the rupee (prototype). */
export const autoGst = (amount: number, rate: number) => Math.round((amount * rate) / (100 + rate));

export const sectionHead = "px-4 pb-1 pt-4 text-[10.5px] font-bold uppercase tracking-[.07em] text-muted";
export const tagCls = "inline-flex h-[22px] items-center rounded-full border border-hair px-[9px] text-[10.5px] font-semibold";
export const TAG = {
  draft: `${tagCls} bg-chip text-ink`,
  salary: `${tagCls} bg-violet-100/70 text-violet-900`,
  sched: `${tagCls} bg-sky-100/70 text-sky-900`,
  paid: `${tagCls} bg-green-100/70 text-green-800`,
  over: `${tagCls} bg-red-100/70 text-red-800`,
  await: `${tagCls} bg-amber-100/70 text-amber-900`,
  exp: `${tagCls} bg-teal-100/70 text-teal-900`,
};

/** Expenses screen tabs. Lives here (not in the "use client" view) so the server page can read the list. */
export const EXPENSE_TABS = [
  ["DUE", "To pay"],
  ["PAID", "Paid"],
  ["GST", "GST credit"],
  ["BILLS", "All bills"],
  ["TDS", "TDS by payee"],
] as const;
export type ExpenseTab = (typeof EXPENSE_TABS)[number][0];
