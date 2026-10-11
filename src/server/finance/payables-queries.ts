import { addDays, addMonths } from "date-fns";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, fmtDate, parseDateKey, zonedStartOfDay } from "@/lib/time";
import { round2 } from "@/server/finance/money";
import { describeRule } from "@/server/finance/repeat";
import { parseRule } from "@/server/finance/payables-core";
import type { RepeatRule } from "@/server/finance/schemas";

/** Read models for payables (ADR 0009). Plain numbers, ISO strings and company-timezone date keys only. */
export type OccRow = {
  id: string;
  billId: string;
  seq: number;
  label: string | null;
  amount: number;
  dueKey: string;
  status: "DUE" | "PAID";
  paidKey: string | null;
  method: string | null;
  reference: string | null;
  tdsPercent: number | null;
  tdsAmount: number;
  gstAmount: number;
  gstRate: number | null;
  vendorGstin: string | null;
  itcClaimable: boolean;
  hasBill: boolean;
  billName: string | null;
  billMime: string | null;
  inDrive: boolean;
};

export type BillRow = {
  id: string;
  payee: string;
  kind: "REGULAR" | "SALARY";
  salaryUserId: string | null;
  timing: "PREPAID" | "POSTPAID" | "ADVANCE";
  category: string;
  note: string | null;
  plan: "ONE_TIME" | "RECURRING" | "PART";
  amount: number;
  rule: RepeatRule | null;
  ruleText: string | null;
  remindDays: number;
  vendorGstin: string | null;
  occurrences: OccRow[];
};

export const OCC_SELECT = {
  id: true, expenseId: true, seq: true, label: true, amount: true, dueDate: true, status: true, paidAt: true, method: true, reference: true,
  tdsPercent: true, tdsAmount: true, gstAmount: true, gstRate: true, vendorGstin: true, itcClaimable: true, billMime: true, billName: true, billDriveId: true,
} satisfies Prisma.ExpenseOccurrenceSelect;
type OccSel = Prisma.ExpenseOccurrenceGetPayload<{ select: typeof OCC_SELECT }>;

export function toOccRow(o: OccSel, tz: string): OccRow {
  return {
    id: o.id,
    billId: o.expenseId,
    seq: o.seq,
    label: o.label,
    amount: o.amount.toNumber(),
    dueKey: dateKey(o.dueDate, tz),
    status: o.status,
    paidKey: o.paidAt ? dateKey(o.paidAt, tz) : null,
    method: o.method,
    reference: o.reference,
    tdsPercent: o.tdsPercent?.toNumber() ?? null,
    tdsAmount: o.tdsAmount.toNumber(),
    gstAmount: o.gstAmount.toNumber(),
    gstRate: o.gstRate?.toNumber() ?? null,
    vendorGstin: o.vendorGstin,
    itcClaimable: o.itcClaimable,
    hasBill: !!o.billMime,
    billName: o.billName,
    billMime: o.billMime,
    inDrive: !!o.billDriveId,
  };
}

/** Every bill with its occurrences (no file bytes), payees A→Z. */
export async function listBills(): Promise<BillRow[]> {
  const tz = (await getSettings()).timezone;
  const bills = await prisma.expense.findMany({ orderBy: [{ vendor: "asc" }, { createdAt: "asc" }], include: { occurrences: { select: OCC_SELECT, orderBy: [{ dueDate: "asc" }, { seq: "asc" }] } } });
  return bills.map((b) => {
    const rule = parseRule(b.repeatRule);
    return {
      id: b.id,
      payee: b.vendor ?? "",
      kind: b.kind,
      salaryUserId: b.salaryUserId,
      timing: b.timing,
      category: b.category,
      note: b.note,
      plan: b.plan,
      amount: b.amount.toNumber(),
      rule,
      ruleText: rule ? describeRule(rule) : null,
      remindDays: b.remindDays,
      vendorGstin: b.vendorGstin,
      occurrences: b.occurrences.map((o) => toOccRow(o, tz)),
    };
  });
}

export async function getBill(id: string): Promise<BillRow | null> {
  return (await listBills()).find((b) => b.id === id) ?? null;
}

export type PaidRow = OccRow & { payee: string; category: string; kind: string; note: string | null; billDriveId: string | null };

/** PAID occurrences (paid basis) for CSV / Sheets, newest first; optional month (yyyy-MM, by paid date) and category. */
export async function listPaidOccurrences(f: { month?: string | null; category?: string | null } = {}): Promise<{ rows: PaidRow[]; total: number }> {
  const tz = (await getSettings()).timezone;
  const where: Prisma.ExpenseOccurrenceWhereInput = { status: "PAID" };
  if (f.month) {
    const start = parseDateKey(`${f.month}-01`, tz);
    where.paidAt = { gte: start, lt: addMonths(start, 1) };
  }
  if (f.category) where.expense = { category: { equals: f.category, mode: "insensitive" } };
  const occ = await prisma.expenseOccurrence.findMany({ where, orderBy: [{ paidAt: "desc" }, { seq: "desc" }], select: { ...OCC_SELECT, expense: { select: { vendor: true, category: true, kind: true, note: true } } } });
  const rows = occ.map((o) => ({ ...toOccRow(o, tz), payee: o.expense.vendor ?? "", category: o.expense.category, kind: o.expense.kind, note: o.expense.note, billDriveId: o.billDriveId }));
  return { rows, total: round2(rows.reduce((s, r) => s + r.amount, 0)) };
}

export type PayablesTiles = { toPay30: number; overdue: number; gstToClaim: number; billsAttached: number; monthShort: string; month: string };

/** Finance sheet tiles (prototype PAGES.finance): DUE within 30 days (incl. overdue), overdue, this month's claimable GST and bills attached. */
export async function payablesTiles(now = new Date()): Promise<PayablesTiles> {
  const tz = (await getSettings()).timezone;
  const today = zonedStartOfDay(now, tz);
  const month = fmtDate(now, tz, "yyyy-MM");
  const start = parseDateKey(`${month}-01`, tz);
  const [due30, over, gst, bills] = await Promise.all([
    prisma.expenseOccurrence.aggregate({ where: { status: "DUE", dueDate: { lt: addDays(today, 31) } }, _sum: { amount: true } }),
    prisma.expenseOccurrence.aggregate({ where: { status: "DUE", dueDate: { lt: today } }, _sum: { amount: true } }),
    prisma.expenseOccurrence.aggregate({ where: { status: "PAID", itcClaimable: true, paidAt: { gte: start, lt: addMonths(start, 1) } }, _sum: { gstAmount: true } }),
    prisma.expenseOccurrence.count({ where: { status: "PAID", billMime: { not: null }, paidAt: { gte: start, lt: addMonths(start, 1) } } }),
  ]);
  return {
    toPay30: round2(due30._sum.amount?.toNumber() ?? 0),
    overdue: round2(over._sum.amount?.toNumber() ?? 0),
    gstToClaim: round2(gst._sum.gstAmount?.toNumber() ?? 0),
    billsAttached: bills,
    monthShort: fmtDate(now, tz, "MMM"),
    month,
  };
}

/** Active staff a salary bill can be paid to (Admin excluded). */
export async function salaryPeople(): Promise<{ id: string; name: string; role: string }[]> {
  return prisma.user.findMany({ where: { active: true, role: { not: "ADMIN" } }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true } });
}
