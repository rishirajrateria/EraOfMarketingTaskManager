"use server";
import { can, requireUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { recordPaymentCore } from "@/server/finance/payment-core";
import { parseInput, paymentInputSchema } from "@/server/finance/schemas";

/** "Mark as paid" (SPEC §11.3): records a payment, generates + emails the receipt. ADMIN only. */
export type RecordPaymentView = { paymentId: string; receiptNumber: string | null; status: "PAID" | "PARTIALLY_PAID"; balance: number; totalReceived: number };

export async function recordPayment(raw: unknown): Promise<ActionResult<RecordPaymentView>> {
  return wrap(async () => {
    const actor = await requireUser();
    if (!can.financeWrite(actor)) throw new ForbiddenError("Only Admin can record payments");
    const input = parseInput(paymentInputSchema, raw);
    const res = await recordPaymentCore(input, actor.id);
    safeRevalidate("/admin/invoices", `/admin/invoices/${input.invoiceId}`, "/admin/finance");
    return { paymentId: res.payment.id, receiptNumber: res.payment.receiptNumber, status: res.status, balance: res.balance, totalReceived: res.totalReceived };
  });
}
