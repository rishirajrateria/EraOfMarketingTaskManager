"use server";
import { can, requireUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { recordPaymentCore, sendReceiptCore, type SendReceiptResult } from "@/server/finance/payment-core";
import { parseInput, paymentInputSchema, sendOptionsSchema } from "@/server/finance/schemas";

/** Payments (ADR 0005): record CASH / BANK / UPI with TDS; receipts are sent on demand through the confirm sheet. ADMIN only. */
export type RecordPaymentView = { paymentId: string; receiptNumber: string | null; status: "PAID" | "PARTIALLY_PAID"; balance: number; totalReceived: number; tds: number };

async function requireWrite() {
  const actor = await requireUser();
  if (!can.financeWrite(actor)) throw new ForbiddenError("Only Admin can record payments");
  return actor;
}

export async function recordPayment(raw: unknown): Promise<ActionResult<RecordPaymentView>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const input = parseInput(paymentInputSchema, raw);
    const res = await recordPaymentCore(input, actor.id);
    safeRevalidate("/admin/invoices", `/admin/invoices/${input.invoiceId}`, "/admin/finance", "/admin/payments");
    return { paymentId: res.payment.id, receiptNumber: res.payment.receiptNumber, status: res.status, balance: res.balance, totalReceived: res.totalReceived, tds: res.tds };
  });
}

export async function sendReceipt(paymentId: string, rawOpts: unknown): Promise<ActionResult<SendReceiptResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const opts = parseInput(sendOptionsSchema, rawOpts ?? {});
    const res = await sendReceiptCore(paymentId, opts, actor.id);
    safeRevalidate("/admin/invoices", "/admin/payments");
    return res;
  });
}
