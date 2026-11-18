import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, zonedStartOfDay } from "@/lib/time";
import { round2 } from "@/server/finance/money";
import { BILLED_WHERE, awaitingApproval, financeSummary, paymentsDashboard } from "@/server/finance/queries";
import { payablesTiles } from "@/server/finance/payables-queries";
import { dashRange, lastMonths, monthLong, monthShort, type DashRange } from "@/server/dashboards/period";
import type { DashParams } from "@/server/dashboards/params";

/**
 * Finance dashboard numbers (ADR 0016). Built on the existing finance read models — `paymentsDashboard` (outstanding /
 * overdue per client), `awaitingApproval`, `financeSummary` (monthly received vs paid expenses) and `payablesTiles`
 * (to pay in 30 days, bills overdue) — plus period sums of payments and paid bill occurrences.
 * Income = payments received (tax / export invoices only — proformas and credit notes never take payments);
 * expense = paid bill occurrences by paid date (ADR 0009). Bills are not tied to clients, so with a client filter the
 * expense figures are `null` ("not per client").
 */
export type Bar = { id: string; label: string; value: number; sub?: string };
export type MonthBar = { month: string; label: string; short: string; income: number; expense: number };
export type NextBill = { occId: string; payee: string; label: string | null; amount: number; dueKey: string; overdue: boolean };

export type FinanceDash = {
  range: DashRange;
  received: number;
  invoiced: number;
  tds: number;
  outstanding: number;
  overdue: number;
  toApprove: number;
  spent: number | null;
  net: number | null;
  toPay: number | null;
  gstToClaim: number | null;
  billsOverdue: number | null;
  tdsDeducted: number | null;
  billsPaid: number | null;
  receivedByClient: Bar[];
  owed: Bar[];
  byCategory: Bar[];
  nextBills: NextBill[];
  months: MonthBar[];
};

const sum = <T>(rows: T[], f: (r: T) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
const desc = (a: Bar, b: Bar) => b.value - a.value || a.label.localeCompare(b.label);

export async function financeDashboard(p: Pick<DashParams, "client" | "period">, now = new Date()): Promise<FinanceDash> {
  const tz = (await getSettings()).timezone;
  const range = dashRange(p.period, now, tz);
  const within = { gte: range.start, lt: range.end };
  const client = p.client;
  const today = zonedStartOfDay(now, tz);
  const [dash, awaiting, summary, pay, payments, invoiced, paidOcc, due] = await Promise.all([
    paymentsDashboard({}, now),
    awaitingApproval(),
    client ? Promise.resolve(null) : financeSummary(now),
    client ? Promise.resolve(null) : payablesTiles(now),
    prisma.payment.findMany({
      where: { receivedAt: within, invoice: { docType: { in: ["TAX_INVOICE", "EXPORT_INVOICE"] }, ...(client ? { clientId: client } : {}) } },
      select: { amount: true, tdsAmount: true, invoice: { select: { clientId: true, client: { select: { name: true } } } } },
    }),
    prisma.invoice.aggregate({ where: { ...BILLED_WHERE, approvedAt: within, ...(client ? { clientId: client } : {}) }, _sum: { total: true } }),
    client
      ? Promise.resolve([])
      : prisma.expenseOccurrence.findMany({ where: { status: "PAID", paidAt: within }, select: { amount: true, gstAmount: true, itcClaimable: true, tdsAmount: true, expense: { select: { category: true } } } }),
    client
      ? Promise.resolve([])
      : prisma.expenseOccurrence.findMany({ where: { status: "DUE" }, orderBy: [{ dueDate: "asc" }, { seq: "asc" }], take: 5, select: { id: true, label: true, amount: true, dueDate: true, expense: { select: { vendor: true, category: true } } } }),
  ]);

  const mine = <T extends { clientId: string }>(rows: T[]) => (client ? rows.filter((r) => r.clientId === client) : rows);
  const owedRows = mine(dash.outstandingByClient);
  const overdueRows = mine(dash.overdue);

  const byClient = new Map<string, Bar>();
  for (const pmt of payments) {
    const b = byClient.get(pmt.invoice.clientId) ?? { id: pmt.invoice.clientId, label: pmt.invoice.client.name, value: 0 };
    b.value = round2(b.value + pmt.amount.toNumber());
    byClient.set(pmt.invoice.clientId, b);
  }

  const cats = new Map<string, number>();
  for (const o of paidOcc) cats.set(o.expense.category || "Other", round2((cats.get(o.expense.category || "Other") ?? 0) + o.amount.toNumber()));

  const received = sum(payments, (x) => x.amount.toNumber());
  const spent = client ? null : sum(paidOcc, (o) => o.amount.toNumber());
  const months = summary
    ? lastMonths(now, tz).map((m) => {
        const row = summary.months.find((x) => x.month === m);
        return { month: m, label: monthLong(m), short: monthShort(m), income: row?.received ?? 0, expense: row?.expenses ?? 0 };
      })
    : [];

  return {
    range,
    received,
    invoiced: round2(invoiced._sum.total?.toNumber() ?? 0),
    tds: sum(payments, (x) => x.tdsAmount.toNumber()),
    outstanding: sum(owedRows, (r) => r.balance),
    overdue: sum(overdueRows, (r) => r.balance),
    toApprove: awaiting.filter((a) => !client || a.clientId === client).length,
    spent,
    net: spent === null ? null : round2(received - spent),
    toPay: pay ? pay.toPay30 : null,
    gstToClaim: client ? null : sum(paidOcc.filter((o) => o.itcClaimable), (o) => o.gstAmount.toNumber()),
    billsOverdue: pay ? pay.overdue : null,
    tdsDeducted: client ? null : sum(paidOcc, (o) => o.tdsAmount.toNumber()),
    billsPaid: client ? null : paidOcc.length,
    receivedByClient: [...byClient.values()].filter((b) => b.value > 0).sort(desc),
    owed: owedRows
      .map((r) => {
        const late = overdueRows.find((g) => g.clientId === r.clientId)?.balance ?? 0;
        return { id: r.clientId, label: r.clientName, value: r.balance, sub: late > 0 ? `₹${Math.round(late).toLocaleString("en-IN")} overdue` : undefined };
      })
      .filter((b) => b.value > 0)
      .sort(desc),
    byCategory: [...cats.entries()].map(([label, value]) => ({ id: label, label, value })).filter((b) => b.value > 0).sort(desc),
    nextBills: due.map((o) => ({ occId: o.id, payee: o.expense.vendor || o.expense.category, label: o.label, amount: o.amount.toNumber(), dueKey: dateKey(o.dueDate, tz), overdue: o.dueDate < today })),
    months,
  };
}
