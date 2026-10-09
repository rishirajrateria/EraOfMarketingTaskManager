import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { round2 } from "@/server/finance/money";
import { insertDocument, loadClientTax, loadInvoiceFull, rowsFromModel, singleRow, type InvoiceFull } from "@/server/finance/document-core";
import { SETTLEMENT_INCLUDE, settleInvoice } from "@/server/finance/settlement";
import { syncPartFromInvoice } from "@/server/finance/parts-core";
import { afterInvoicePaid } from "@/server/finance/payment-core";
import type { CreditNoteInput } from "@/server/finance/schemas";

/**
 * Corrections (ADR 0005): credit notes offset an approved invoice (full → CANCELLED, partial → lower balance);
 * a proforma converts into the tax / export invoice. Both results are AWAITING_APPROVAL documents.
 */
const CREDITABLE = ["TAX_INVOICE", "EXPORT_INVOICE"] as const;

export async function createCreditNoteCore(invoiceId: string, input: CreditNoteInput, actorId: string | null): Promise<InvoiceFull> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, creditNotes: { where: { status: { not: "CANCELLED" } }, select: { subtotal: true } } } });
  if (!inv) throw new Error("Invoice not found");
  if (!CREDITABLE.includes(inv.docType as (typeof CREDITABLE)[number])) throw new Error("Credit notes can only be raised against tax or export invoices");
  if (!inv.approvedAt) throw new Error("Only approved invoices can be credited");
  if (inv.status === "CANCELLED") throw new Error("Invoice is already cancelled");
  const already = round2(inv.creditNotes.reduce((s, c) => s + c.subtotal.toNumber(), 0));
  const creditable = round2(inv.subtotal.toNumber() - already);
  const amount = round2(input.amount ?? creditable);
  if (amount <= 0) throw new Error("Nothing left to credit on this invoice");
  if (amount > creditable + 0.005) throw new Error(`At most ${creditable} (taxable) can still be credited on ${inv.number}`);
  const full = Math.abs(amount - inv.subtotal.toNumber()) <= 0.005;
  return prisma.$transaction((tx) =>
    insertDocument(
      tx,
      {
        clientId: inv.clientId,
        docType: "CREDIT_NOTE",
        taxMode: inv.taxMode,
        placeOfSupply: inv.placeOfSupply,
        plan: "ONE_TIME",
        gstPercent: inv.gstPercent.toNumber(),
        items: full ? rowsFromModel(inv.items) : singleRow(`Credit against ${inv.number}: ${input.reason}`, amount, inv.items[0]?.hsnSac ?? null),
        description: input.reason,
        dueDate: null,
        notes: inv.notes,
        creditNoteOfId: inv.id,
      },
      actorId,
      "invoice.credit_note_create",
      { of: inv.number, amount, full },
    ),
  );
}

/**
 * Apply an approved credit note to its invoice: credited total ≥ invoice total → CANCELLED; otherwise the balance
 * drops (PAID when payments + TDS + credit notes now cover it).
 */
export async function applyCreditNoteEffect(creditNoteId: string, actorId: string | null, tx: Prisma.TransactionClient | typeof prisma = prisma): Promise<{ invoiceId: string; status: string } | null> {
  const cn = await tx.invoice.findUnique({ where: { id: creditNoteId }, select: { id: true, number: true, total: true, creditNoteOfId: true, approvedAt: true } });
  if (!cn?.creditNoteOfId) return null;
  const inv = await tx.invoice.findUnique({ where: { id: cn.creditNoteOfId }, include: SETTLEMENT_INCLUDE });
  if (!inv) return null;
  // `creditNotes` only holds approved notes; include this one when it is being applied before its approval stamp.
  const withThis = cn.approvedAt ? inv.creditNotes : inv.creditNotes.concat([{ total: cn.total }]);
  const credited = round2(withThis.reduce((s, c) => s + c.total.toNumber(), 0));
  const s = settleInvoice({ ...inv, creditNotes: withThis });
  const now = new Date();
  let status = inv.status;
  if (credited >= inv.total.toNumber() - 0.005) {
    status = "CANCELLED";
    await tx.invoice.update({ where: { id: inv.id }, data: { status, cancelledAt: inv.cancelledAt ?? now } });
    await syncPartFromInvoice(tx, inv.id, "CANCELLED");
  } else if (s.paid && inv.status !== "PAID") {
    status = "PAID";
    await tx.invoice.update({ where: { id: inv.id }, data: { status } });
    await syncPartFromInvoice(tx, inv.id, "PAID");
  }
  await audit(actorId, "invoice.credit_note_apply", "Invoice", inv.id, { status: inv.status }, { status, creditNote: cn.number, credited, balance: s.balance }, tx);
  if (status === "PAID" && inv.status !== "PAID") await afterInvoicePaid(inv.id, actorId);
  return { invoiceId: inv.id, status };
}

/** Proforma → tax / export invoice with the tax resolved now; the proforma stays as it is and links to the result. */
export async function convertProformaCore(id: string, actorId: string | null): Promise<InvoiceFull> {
  const pro = await loadInvoiceFull(id);
  if (!pro) throw new Error("Invoice not found");
  if (pro.docType !== "PROFORMA") throw new Error("Only a proforma can be converted");
  if (pro.status === "CANCELLED") throw new Error("Proforma is cancelled");
  const existing = await prisma.invoice.findUnique({ where: { proformaOfId: pro.id }, select: { id: true } });
  if (existing) throw new Error("This proforma has already been converted");
  const { company, tax } = await loadClientTax(pro.clientId);
  const gstPercent = pro.gstPercent.toNumber() > 0 ? pro.gstPercent.toNumber() : company.defaultGstPercent;
  return prisma.$transaction((tx) =>
    insertDocument(
      tx,
      {
        clientId: pro.clientId,
        docType: tax.docType,
        taxMode: tax.taxMode,
        placeOfSupply: tax.placeOfSupply,
        plan: "ONE_TIME",
        gstPercent,
        items: rowsFromModel(pro.items),
        description: pro.description,
        dueDate: pro.dueDate,
        notes: pro.notes,
        paymentTerms: pro.paymentTerms,
        proformaOfId: pro.id,
      },
      actorId,
      "invoice.proforma_convert",
      { proforma: pro.number },
    ),
  );
}
