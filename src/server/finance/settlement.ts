import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { settle, type Settlement } from "@/server/finance/money";

/** What counts against an invoice's balance (ADR 0005): payments, TDS, and approved (not cancelled) credit notes. */
export const APPROVED_CREDIT_NOTE_WHERE = { approvedAt: { not: null }, status: { not: "CANCELLED" } } satisfies Prisma.InvoiceWhereInput;

export const SETTLEMENT_INCLUDE = {
  payments: { select: { amount: true, tdsAmount: true } },
  creditNotes: { where: APPROVED_CREDIT_NOTE_WHERE, select: { total: true } },
} satisfies Prisma.InvoiceInclude;

type SettleRow = Prisma.InvoiceGetPayload<{ select: { total: true }; include: typeof SETTLEMENT_INCLUDE }>;

export function settleInvoice(inv: Pick<SettleRow, "total" | "payments" | "creditNotes">): Settlement {
  return settle({
    total: inv.total.toNumber(),
    payments: inv.payments.map((p) => ({ amount: p.amount.toNumber(), tdsAmount: p.tdsAmount.toNumber() })),
    creditNotes: inv.creditNotes.map((c) => ({ total: c.total.toNumber() })),
  });
}

export async function loadSettlement(invoiceId: string, tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<Settlement & { total: number }> {
  const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: SETTLEMENT_INCLUDE });
  if (!inv) throw new Error("Invoice not found");
  return { ...settleInvoice(inv), total: inv.total.toNumber() };
}

/** Balance outstanding for an invoice (total − payments − TDS − credit notes). */
export async function invoiceBalance(invoiceId: string): Promise<number> {
  try {
    return (await loadSettlement(invoiceId)).balance;
  } catch {
    return 0;
  }
}
