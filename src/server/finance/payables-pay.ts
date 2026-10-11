import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fmtDate } from "@/lib/time";
import { formatCurrency, round2 } from "@/server/finance/money";
import { billFileData, refileBill, type BillFile } from "@/server/finance/bill-files";
import { BALANCE_PREFIX, companyTz, createNextOccurrence, dueFromKey, paidAtFromKey, tdsCheckAfterPayment } from "@/server/finance/payables-core";
import type { GstFields, MarkPaidInput } from "@/server/finance/schemas";

/**
 * Paying bills (ADR 0009, prototype `markPaid` / `occSheet` / `billDetailsSheet`): mark an occurrence paid (a
 * smaller amount leaves a "Balance of …" DUE occurrence; a recurring bill gets its next occurrence), undo, move the
 * due date, skip a recurring one, and attach the vendor's bill with its GST details. No auth — callers check RBAC.
 */
const D = (n: number) => new Prisma.Decimal(round2(n));
const BILL = { id: true, vendor: true, kind: true, plan: true, amount: true, repeatRule: true, category: true } as const;

async function loadOccurrence(id: string) {
  const o = await prisma.expenseOccurrence.findUnique({ where: { id }, include: { expense: { select: BILL } } });
  if (!o) throw new Error("Payment not found");
  return o;
}

/** GST block → occurrence columns. Auto GST = amount × rate / (100 + rate) (GST is inside the amount). */
export function gstData(gst: GstFields | null | undefined, amount: number) {
  if (!gst?.includesGst) return { gstAmount: D(0), gstRate: null, vendorGstin: null, itcClaimable: false };
  const rate = gst.gstRate ?? 18;
  const value = gst.gstAmount ?? round2((amount * rate) / (100 + rate));
  if (value > amount + 0.005) throw new Error("GST cannot be more than the bill");
  return { gstAmount: D(value), gstRate: new Prisma.Decimal(rate), vendorGstin: gst.vendorGstin?.toUpperCase() || null, itcClaimable: gst.itcClaimable && value > 0 };
}

export type MarkPaidResult = { message: string; tdsWarning: string | null; balanceId: string | null; nextId: string | null };

export async function markPaidCore(occurrenceId: string, input: MarkPaidInput, file: BillFile | null, actorId: string): Promise<MarkPaidResult> {
  const tz = await companyTz();
  const o = await loadOccurrence(occurrenceId);
  if (o.status === "PAID") throw new Error("Already marked paid");
  const bill = o.expense;
  const due = o.amount.toNumber();
  const amount = round2(input.amount);
  const tdsAmount = input.tdsAmount != null ? round2(input.tdsAmount) : input.tdsPercent ? round2((amount * input.tdsPercent) / 100) : 0;
  if (tdsAmount > amount + 0.005) throw new Error("TDS cannot be more than the payment");
  const gst = gstData(input.gst ?? (o.gstAmount.toNumber() > 0 ? { includesGst: true, gstRate: o.gstRate?.toNumber() ?? null, gstAmount: null, vendorGstin: o.vendorGstin, itcClaimable: o.itcClaimable } : null), amount);
  const paidAt = paidAtFromKey(input.paidOn, tz);
  const rest = round2(due - amount);
  const fmt = (d: Date) => fmtDate(d, tz, "dd MMM");

  const res = await prisma.$transaction(async (tx) => {
    await tx.expenseOccurrence.update({
      where: { id: o.id },
      data: {
        amount: D(amount),
        status: "PAID",
        paidAt,
        method: input.method,
        reference: input.reference,
        tdsAmount: D(tdsAmount),
        tdsPercent: tdsAmount > 0 && input.tdsPercent != null ? new Prisma.Decimal(input.tdsPercent) : null,
        ...gst,
        ...(file ? billFileData(file) : {}),
        notifiedAt: o.notifiedAt ?? new Date(),
      },
    });
    if (gst.vendorGstin) await tx.expense.update({ where: { id: bill.id }, data: { vendorGstin: gst.vendorGstin } });
    let message = "Marked paid";
    let balanceId: string | null = null;
    let nextId: string | null = null;
    const maxSeq = (await tx.expenseOccurrence.aggregate({ where: { expenseId: bill.id }, _max: { seq: true } }))._max.seq ?? 0;
    if (rest > 0.5) {
      const b = await tx.expenseOccurrence.create({ data: { expenseId: bill.id, seq: maxSeq + 1, amount: D(rest), dueDate: o.dueDate, label: `${BALANCE_PREFIX}${o.label || "payment"}` } });
      balanceId = b.id;
      message = `Part paid · balance ${formatCurrency(rest)} still due`;
    }
    const stillDue = await tx.expenseOccurrence.findMany({ where: { expenseId: bill.id, status: "DUE" }, orderBy: [{ dueDate: "asc" }, { seq: "asc" }] });
    if (bill.plan === "RECURRING" && stillDue.length === 0) {
      const n = await createNextOccurrence(tx, bill, o.dueDate, tz);
      if (n) {
        nextId = n.id;
        message += ` · next ${formatCurrency(n.amount.toNumber())} on ${fmt(n.dueDate)}`;
      }
    }
    if (bill.plan === "PART") message += stillDue[0] ? ` · next: ${stillDue[0].label || "part"} ${formatCurrency(stillDue[0].amount.toNumber())} on ${fmt(stillDue[0].dueDate)}` : " · all parts paid";
    await audit(actorId, "expense.pay", "ExpenseOccurrence", o.id, { status: "DUE", amount: due }, { amount, paidOn: input.paidOn, method: input.method, tdsAmount, gst: gst.gstAmount.toNumber(), itc: gst.itcClaimable, balance: rest > 0.5 ? rest : 0, hasBill: !!file }, tx);
    return { message, balanceId, nextId };
  });
  await refileBill(o.id, file ? [o.billDriveId, o.itcDriveId] : []);
  const tdsWarning = await tdsCheckAfterPayment(bill, paidAt, tdsAmount);
  return { ...res, tdsWarning };
}

/** Back to To pay: clears the payment, method and TDS (GST details and the bill file stay); Drive copies are trashed. */
export async function undoPaidCore(occurrenceId: string, actorId: string): Promise<void> {
  const o = await loadOccurrence(occurrenceId);
  if (o.status !== "PAID") throw new Error("This payment is not marked paid");
  await prisma.expenseOccurrence.update({ where: { id: o.id }, data: { status: "DUE", paidAt: null, method: null, reference: null, tdsAmount: D(0), tdsPercent: null } });
  await audit(actorId, "expense.unpay", "ExpenseOccurrence", o.id, { status: "PAID", paidAt: o.paidAt, method: o.method, tdsAmount: o.tdsAmount.toNumber() }, { status: "DUE" });
  await refileBill(o.id);
}

/** New due date for a DUE occurrence; the reminder will be sent again for the new date. */
export async function moveDueDateCore(occurrenceId: string, dueKey: string, actorId: string): Promise<void> {
  const tz = await companyTz();
  const o = await loadOccurrence(occurrenceId);
  if (o.status !== "DUE") throw new Error("Only unpaid payments can be moved");
  const dueDate = dueFromKey(dueKey, tz);
  await prisma.expenseOccurrence.update({ where: { id: o.id }, data: { dueDate, notifiedAt: null } });
  await audit(actorId, "expense.move_due", "ExpenseOccurrence", o.id, { dueDate: o.dueDate }, { dueDate });
}

/** Recurring only: drop this occurrence (no payment this time); when nothing else is due, the next one is created. */
export async function skipOccurrenceCore(occurrenceId: string, actorId: string): Promise<{ nextDue: Date | null }> {
  const tz = await companyTz();
  const o = await loadOccurrence(occurrenceId);
  if (o.expense.plan !== "RECURRING") throw new Error("Only recurring payments can be skipped");
  if (o.status !== "DUE") throw new Error("Only unpaid payments can be skipped");
  return prisma.$transaction(async (tx) => {
    await tx.expenseOccurrence.delete({ where: { id: o.id } });
    const due = await tx.expenseOccurrence.count({ where: { expenseId: o.expenseId, status: "DUE" } });
    const next = due === 0 ? await createNextOccurrence(tx, o.expense, o.dueDate, tz) : null;
    await audit(actorId, "expense.skip", "ExpenseOccurrence", o.id, { dueDate: o.dueDate, amount: o.amount.toNumber() }, { next: next?.dueDate ?? null }, tx);
    return { nextDue: next?.dueDate ?? null };
  });
}

/** "Bill & GST details": attach / replace / remove the vendor's bill and set the GST fields on any occurrence. */
export async function billDetailsCore(occurrenceId: string, gst: GstFields, file: BillFile | null, removeFile: boolean, actorId: string): Promise<void> {
  const o = await loadOccurrence(occurrenceId);
  const g = gstData(gst, o.amount.toNumber());
  const fileData = file ? billFileData(file) : removeFile ? { billData: null, billMime: null, billName: null, billDriveId: null, itcDriveId: null } : {};
  await prisma.$transaction(async (tx) => {
    await tx.expenseOccurrence.update({ where: { id: o.id }, data: { ...g, ...fileData } });
    if (g.vendorGstin) await tx.expense.update({ where: { id: o.expenseId }, data: { vendorGstin: g.vendorGstin } });
    await audit(actorId, "expense.bill_details", "ExpenseOccurrence", o.id, { gst: o.gstAmount.toNumber(), itc: o.itcClaimable, hasBill: !!o.billMime }, { gst: g.gstAmount.toNumber(), itc: g.itcClaimable, hasBill: file ? true : removeFile ? false : !!o.billMime }, tx);
  });
  await refileBill(o.id, file || removeFile ? [o.billDriveId, o.itcDriveId] : []);
}
