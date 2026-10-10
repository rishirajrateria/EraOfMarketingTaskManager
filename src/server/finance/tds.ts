import { Prisma } from "@prisma/client";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { parseDateKey } from "@/lib/time";
import { round2 } from "@/server/finance/money";
import { financialYearKey } from "@/server/finance/numbering";

/**
 * TDS helpers (ADR 0006). The financial year runs 1 April – 31 March in the company timezone.
 * - Receivable: TDS the clients deduct on our invoices (Payment.tdsAmount) — a credit at year end.
 * - On expenses: TDS we must deduct when paying a payee once the FY total reaches the threshold
 *   (CompanySettings.tdsThresholdAmount, per payee, resets every 1 April). ADR 0009: computed from PAID bill
 *   occurrences by paid date; salary bills are excluded from the payee threshold.
 */
export type FyRange = { start: Date; end: Date; key: string };

/** [1 April, next 1 April) around `date` in `tz`, plus the "25-26" key used by numbering. */
export function fyRange(date: Date, tz: string): FyRange {
  const year = Number(formatInTimeZone(date, tz, "yyyy"));
  const month = Number(formatInTimeZone(date, tz, "M"));
  const startYear = month >= 4 ? year : year - 1;
  return { start: parseDateKey(`${startYear}-04-01`, tz), end: parseDateKey(`${startYear + 1}-04-01`, tz), key: financialYearKey(date, tz) };
}

/** Payees are matched case-insensitively on the trimmed vendor text. */
export function vendorKey(vendor: string | null | undefined): string {
  return (vendor ?? "").trim().toLowerCase();
}

async function tz(): Promise<string> {
  return (await getSettings()).timezone;
}

/** PAID occurrences of regular (non-salary) bills paid to `vendor` (case-insensitive) within `range` (ADR 0009: paid basis). */
function payeeWhere(vendor: string, range: { gte: Date; lt: Date }, excludeOccurrenceId?: string | null): Prisma.ExpenseOccurrenceWhereInput {
  return {
    status: "PAID",
    paidAt: range,
    expense: { kind: "REGULAR", vendor: { equals: vendor.trim(), mode: "insensitive" } },
    ...(excludeOccurrenceId ? { id: { not: excludeOccurrenceId } } : {}),
  };
}

/** Gross paid to `vendor` in the FY that contains `date` (paid occurrences, salaries excluded), optionally excluding one payment. */
export async function vendorFyTotal(vendor: string, date: Date, excludeOccurrenceId?: string | null): Promise<number> {
  if (!vendorKey(vendor)) return 0;
  const fy = fyRange(date, await tz());
  const agg = await prisma.expenseOccurrence.aggregate({ where: payeeWhere(vendor, { gte: fy.start, lt: fy.end }, excludeOccurrenceId), _sum: { amount: true } });
  return round2(agg._sum.amount?.toNumber() ?? 0);
}

export type TdsThresholdStatus = {
  vendor: string;
  fyKey: string;
  /** Gross paid to this payee so far in the FY (other payments). */
  paidSoFar: number;
  /** paidSoFar + the amount being recorded. */
  withThis: number;
  threshold: number;
  /** TDS applies: this expense takes (or keeps) the payee at or over the threshold. */
  crossed: boolean;
  /** The payee was already at or over the threshold before this expense. */
  alreadyCrossed: boolean;
};

/** Where `vendor` stands against the threshold once `amount` (paid on `date`) is added. */
export async function tdsThresholdStatus(vendor: string, amount: number, date: Date, excludeOccurrenceId?: string | null): Promise<TdsThresholdStatus> {
  const settings = await getSettings();
  const threshold = Number(settings.tdsThresholdAmount);
  const fy = fyRange(date, settings.timezone);
  const paidSoFar = await vendorFyTotal(vendor, date, excludeOccurrenceId);
  const withThis = round2(paidSoFar + (Number.isFinite(amount) ? amount : 0));
  return { vendor: vendor.trim(), fyKey: fy.key, paidSoFar, withThis, threshold, crossed: withThis >= threshold, alreadyCrossed: paidSoFar >= threshold };
}

/** One-line warning for the expense form / toast, or null when TDS is handled or not due. */
export function tdsWarningText(s: TdsThresholdStatus, tdsApplied: boolean): string | null {
  if (tdsApplied || !s.crossed || !s.vendor) return null;
  return `Paid ₹${s.withThis.toLocaleString("en-IN")} to ${s.vendor} this FY (threshold ₹${s.threshold.toLocaleString("en-IN")}). TDS applies.`;
}

export type VendorTdsRow = { vendor: string; paid: number; tds: number; expenses: number; crossed: boolean };
export type VendorTdsSummary = { fyKey: string; threshold: number; vendors: VendorTdsRow[] };

/** Per-payee totals for the FY containing `now` on a paid basis (salaries excluded): gross paid, TDS deducted, payments, threshold reached. */
export async function vendorTdsSummary(now = new Date()): Promise<VendorTdsSummary> {
  const settings = await getSettings();
  const fy = fyRange(now, settings.timezone);
  const threshold = Number(settings.tdsThresholdAmount);
  const rows = await prisma.expenseOccurrence.findMany({
    where: { status: "PAID", paidAt: { gte: fy.start, lt: fy.end }, expense: { kind: "REGULAR", vendor: { not: null } } },
    select: { amount: true, tdsAmount: true, expense: { select: { vendor: true } } },
    orderBy: { paidAt: "asc" },
  });
  const map = new Map<string, VendorTdsRow>();
  for (const r of rows) {
    const key = vendorKey(r.expense.vendor);
    if (!key) continue;
    const v = map.get(key) ?? { vendor: r.expense.vendor!.trim(), paid: 0, tds: 0, expenses: 0, crossed: false };
    v.paid = round2(v.paid + r.amount.toNumber());
    v.tds = round2(v.tds + r.tdsAmount.toNumber());
    v.expenses++;
    v.crossed = v.paid >= threshold;
    map.set(key, v);
  }
  return { fyKey: fy.key, threshold, vendors: Array.from(map.values()).sort((a, b) => b.paid - a.paid) };
}

export type TdsSummary = {
  fyKey: string;
  start: string;
  end: string;
  /** TDS clients deducted on payments received in the FY (credit due to the company). */
  receivable: number;
  /** TDS the company deducted on bill payments made in the FY (paid occurrences, salaries included). */
  onExpenses: number;
  byClient: { clientId: string; clientName: string; tds: number; payments: number }[];
};

/** Year-end TDS view for the finance sheet (ADR 0006). `at` picks the FY (any instant inside it). */
export async function tdsSummary(at = new Date()): Promise<TdsSummary> {
  const fy = fyRange(at, await tz());
  const range = { gte: fy.start, lt: fy.end };
  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({ where: { receivedAt: range, tdsAmount: { gt: new Prisma.Decimal(0) } }, select: { tdsAmount: true, invoice: { select: { clientId: true, client: { select: { name: true } } } } } }),
    prisma.expenseOccurrence.aggregate({ where: { status: "PAID", paidAt: range }, _sum: { tdsAmount: true } }),
  ]);
  const clients = new Map<string, TdsSummary["byClient"][number]>();
  for (const p of payments) {
    const c = clients.get(p.invoice.clientId) ?? { clientId: p.invoice.clientId, clientName: p.invoice.client.name, tds: 0, payments: 0 };
    c.tds = round2(c.tds + p.tdsAmount.toNumber());
    c.payments++;
    clients.set(c.clientId, c);
  }
  const byClient = Array.from(clients.values()).sort((a, b) => b.tds - a.tds);
  return {
    fyKey: fy.key,
    start: fy.start.toISOString(),
    end: fy.end.toISOString(),
    receivable: round2(byClient.reduce((s, c) => s + c.tds, 0)),
    onExpenses: round2(expenses._sum.tdsAmount?.toNumber() ?? 0),
    byClient,
  };
}
