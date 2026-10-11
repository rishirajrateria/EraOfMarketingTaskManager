"use server";
import { prisma } from "@/lib/db";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { requireFinanceActor } from "@/server/finance/guard";
import { readBillFile } from "@/server/finance/bill-files";
import { addExpenseCategoryCore, createBillCore, deleteBillCore, updateBillCore, type BillSaveResult } from "@/server/finance/payables-core";
import { billDetailsCore, markPaidCore, moveDueDateCore, skipOccurrenceCore, undoPaidCore, type MarkPaidResult } from "@/server/finance/payables-pay";
import { sendGstPackCore, type SendPackResult } from "@/server/finance/gst-pack";
import { billInputSchema, dateKeySchema, gstFieldsSchema, markPaidSchema, monthKeySchema, parseInput } from "@/server/finance/schemas";

/**
 * Payables server actions (ADR 0009): bills, their payments, the vendor bill + GST details, inline categories and the
 * monthly GST pack. ADMIN only. File uploads travel as FormData (`bill` field, ≤ 12 MB, image or PDF).
 */
const PATHS = ["/admin/expenses", "/admin/finance", "/admin/drive-folders"];
const done = () => safeRevalidate(...PATHS);

export async function createBill(raw: unknown): Promise<ActionResult<BillSaveResult>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    const res = await createBillCore(parseInput(billInputSchema, raw), actor.id);
    done();
    return res;
  });
}

export async function updateBill(id: string, raw: unknown): Promise<ActionResult<BillSaveResult>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    const res = await updateBillCore(id, parseInput(billInputSchema, raw), actor.id);
    done();
    return res;
  });
}

export async function deleteBill(id: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    await deleteBillCore(id, actor.id);
    done();
    return undefined;
  });
}

/** Record a payment: amount, paid on, method, reference, TDS, the Bill & GST block, optional bill file (`files.bill`). */
export async function markPaid(occurrenceId: string, raw: unknown, files?: FormData | null): Promise<ActionResult<MarkPaidResult>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    const input = parseInput(markPaidSchema, raw);
    const file = await readBillFile(files);
    const res = await markPaidCore(occurrenceId, input, file, actor.id);
    done();
    return res;
  });
}

export async function undoPaid(occurrenceId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    await undoPaidCore(occurrenceId, actor.id);
    done();
    return undefined;
  });
}

export async function moveDueDate(occurrenceId: string, dueKey: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    await moveDueDateCore(occurrenceId, parseInput(dateKeySchema, dueKey), actor.id);
    done();
    return undefined;
  });
}

export async function skipOccurrence(occurrenceId: string): Promise<ActionResult<{ nextDue: string | null }>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    const res = await skipOccurrenceCore(occurrenceId, actor.id);
    done();
    return { nextDue: res.nextDue?.toISOString() ?? null };
  });
}

/** "Bill & GST details": GST fields plus an optional new file (`files.bill`) or `removeFile`. */
export async function billDetails(occurrenceId: string, rawGst: unknown, files?: FormData | null, removeFile = false): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    const gst = parseInput(gstFieldsSchema, rawGst ?? {});
    const file = await readBillFile(files);
    await billDetailsCore(occurrenceId, gst, file, removeFile && !file, actor.id);
    done();
    return undefined;
  });
}

/** Attach (or replace) just the vendor's bill file, keeping the GST details. */
export async function attachBill(occurrenceId: string, files: FormData): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    const file = await readBillFile(files);
    if (!file) throw new Error("Choose the bill (PDF or photo)");
    const o = await prisma.expenseOccurrence.findUnique({ where: { id: occurrenceId }, select: { gstAmount: true, gstRate: true, vendorGstin: true, itcClaimable: true } });
    if (!o) throw new Error("Payment not found");
    const gst = { includesGst: o.gstAmount.toNumber() > 0, gstRate: o.gstRate?.toNumber() ?? null, gstAmount: o.gstAmount.toNumber() || null, vendorGstin: o.vendorGstin, itcClaimable: o.itcClaimable };
    await billDetailsCore(occurrenceId, gst, file, false, actor.id);
    done();
    return undefined;
  });
}

/** Inline "+ New" in the category select: appended to the Settings list (case-insensitive dedupe). */
export async function addExpenseCategory(name: string): Promise<ActionResult<{ category: string; categories: string[] }>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    const res = await addExpenseCategoryCore(String(name ?? ""), actor.id);
    safeRevalidate(...PATHS, "/admin/settings");
    return res;
  });
}

/** Email the month's GST pack (ZIP + summary) to the finance person; the address is saved in Settings. */
export async function sendGstPack(month: string, email: string): Promise<ActionResult<SendPackResult>> {
  return wrap(async () => {
    const actor = await requireFinanceActor();
    const res = await sendGstPackCore(parseInput(monthKeySchema, month), String(email ?? ""), actor.id);
    safeRevalidate(...PATHS, "/admin/settings");
    return res;
  });
}
