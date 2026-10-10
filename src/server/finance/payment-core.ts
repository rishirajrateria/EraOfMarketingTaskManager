import { Prisma, type Payment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminIds, notify } from "@/lib/notify";
import { sendMail } from "@/google/gmail";
import { sendWhatsapp } from "@/integrations/whatsapp";
import { allocateReceiptNumber } from "@/server/finance/numbering";
import { formatCurrency, formatINRPlain, round2 } from "@/server/finance/money";
import { renderReceiptPdf } from "@/server/finance/pdf";
import { loadCompany } from "@/server/finance/document-core";
import { storeForClientAndFinance, toBytes } from "@/server/finance/drive-store";
import { SETTLEMENT_INCLUDE, settleInvoice } from "@/server/finance/settlement";
import { syncPartFromInvoice } from "@/server/finance/parts-core";
import { resumeWorkCore } from "@/server/finance/hold-work";
import type { PaymentInput, SendOptions } from "@/server/finance/schemas";

export type RecordPaymentResult = { payment: Payment; status: "PAID" | "PARTIALLY_PAID"; balance: number; totalReceived: number; tds: number };

const PAYABLE = ["SENT", "PARTIALLY_PAID", "OVERDUE"] as const;

/**
 * Record a payment against an invoice (ADR 0005): Payment row with method + TDS and a receipt number, invoice
 * status PAID when payments + TDS + credit notes cover the total, receipt PDF stored + uploaded to Drive.
 * Receipts are NOT emailed here — `sendReceiptCore` delivers them on demand.
 */
export async function recordPaymentCore(input: PaymentInput, actorId: string | null): Promise<RecordPaymentResult> {
  const receivedAt = input.receivedAt ?? new Date();
  const res = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { client: true, ...SETTLEMENT_INCLUDE } });
    if (!inv) throw new Error("Invoice not found");
    if (inv.docType === "PROFORMA") throw new Error("A proforma cannot receive payments — convert it to a tax invoice first");
    if (inv.docType === "CREDIT_NOTE") throw new Error("Credit notes cannot receive payments");
    if (inv.status === "CANCELLED") throw new Error("Invoice is cancelled");
    if (inv.status === "PAID") throw new Error("Invoice is already paid");
    if (!inv.approvedAt && !PAYABLE.includes(inv.status as (typeof PAYABLE)[number])) throw new Error("Invoice has not been approved yet");
    const tdsAmount = round2(input.tdsAmount ?? (input.tdsPercent != null ? (inv.subtotal.toNumber() * input.tdsPercent) / 100 : 0));
    const receiptNumber = await allocateReceiptNumber(tx);
    const payment = await tx.payment.create({
      data: {
        invoiceId: inv.id,
        amount: new Prisma.Decimal(round2(input.amount)),
        receivedAt,
        method: input.method,
        tdsAmount: new Prisma.Decimal(tdsAmount),
        tdsPercent: input.tdsPercent != null ? new Prisma.Decimal(input.tdsPercent) : null,
        notes: input.notes,
        reference: input.reference,
        receiptNumber,
      },
    });
    const s = settleInvoice({ ...inv, payments: [...inv.payments, { amount: payment.amount, tdsAmount: payment.tdsAmount }] });
    const status = s.paid ? "PAID" : "PARTIALLY_PAID";
    // ADR 0006: a TDS deduction on an invoice marked "no TDS" flips the flag so the year-end total stays right.
    await tx.invoice.update({ where: { id: inv.id }, data: { status, ...(tdsAmount > 0 && !inv.tdsApplicable ? { tdsApplicable: true } : {}) } });
    if (status === "PAID") await syncPartFromInvoice(tx, inv.id, "PAID");
    await audit(actorId, "invoice.payment", "Invoice", inv.id, { status: inv.status }, { status, amount: input.amount, tdsAmount, method: input.method, receiptNumber }, tx);
    return { inv, payment, status, settlement: s } as const;
  });

  const { inv, payment, status, settlement } = res;
  const company = await loadCompany();
  const pdf = await renderReceiptPdf(
    {
      receiptNumber: payment.receiptNumber!,
      receivedAt,
      amount: payment.amount.toNumber(),
      tdsAmount: payment.tdsAmount.toNumber(),
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      invoiceNumber: inv.number,
      invoiceTotal: inv.total.toNumber(),
      totalReceived: settlement.settled,
      balance: settlement.balance,
      currency: inv.currency,
    },
    inv.client,
    company,
  );
  const { clientFileId, backendFileId } = await storeForClientAndFinance(inv.client, "Receipts", { name: `${payment.receiptNumber}.pdf`, mimeType: "application/pdf", data: pdf });
  const saved = await prisma.payment.update({ where: { id: payment.id }, data: { receiptPdfData: toBytes(pdf), receiptPdfId: clientFileId, receiptBackendPdfId: backendFileId } });
  if (status === "PAID") await afterInvoicePaid(inv.id, actorId);
  else {
    const money = (n: number) => formatCurrency(n, inv.currency);
    await notify({ userIds: await adminIds(), kind: "PAYMENT_RECEIVED", title: `${money(payment.amount.toNumber())} received from ${inv.client.name} · ${money(settlement.balance)} still due`, body: inv.number, href: `/admin/invoices/${inv.id}`, invoiceId: inv.id });
  }
  return { payment: saved, status, balance: settlement.balance, totalReceived: settlement.received, tds: settlement.tds };
}

/** Side effects once an invoice is fully settled: admins notified; a client on hold for it gets its work resumed. */
export async function afterInvoicePaid(invoiceId: string, actorId: string | null): Promise<void> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { id: true, number: true, total: true, clientId: true, client: { select: { name: true, workOnHold: true, holdInvoiceId: true } } } });
  if (!inv) return;
  await notify({ userIds: await adminIds(), kind: "INVOICE_PAID", title: `Invoice ${inv.number} paid in full by ${inv.client.name}`, body: formatINRPlain(inv.total.toNumber()), href: `/admin/invoices/${inv.id}`, invoiceId: inv.id });
  if (inv.client.workOnHold && inv.client.holdInvoiceId === inv.id) {
    await resumeWorkCore(inv.clientId, actorId).catch((e) => console.error("[finance] auto-resume failed", inv.clientId, e));
  }
}

export type SendReceiptResult = { receiptSentAt: Date; emailed: boolean; whatsapped: boolean; errors: string[] };

/** Deliver a receipt on demand (confirm sheet): email with the PDF, WhatsApp as text with the amounts. */
export async function sendReceiptCore(paymentId: string, opts: SendOptions, actorId: string | null): Promise<SendReceiptResult> {
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: { include: { client: true, ...SETTLEMENT_INCLUDE } } } });
  if (!p) throw new Error("Payment not found");
  if (!opts.email && !opts.whatsapp) throw new Error("Pick at least one channel");
  const inv = p.invoice;
  const company = await loadCompany();
  const s = settleInvoice(inv);
  const errors: string[] = [];
  let emailed = false;
  let whatsapped = false;
  const amount = p.amount.toNumber();
  const tds = p.tdsAmount.toNumber();
  const summary = `We have received ${formatINRPlain(amount)}${tds > 0 ? ` (plus TDS ${formatINRPlain(tds)})` : ""} against invoice ${inv.number}. Balance outstanding: ${formatINRPlain(s.balance)}.`;
  if (opts.email) {
    if (!inv.client.email) errors.push("Client has no email on file");
    else {
      try {
        const pdf = p.receiptPdfData && p.receiptPdfData.length > 0 ? Buffer.from(p.receiptPdfData) : null;
        await sendMail({
          to: inv.client.email,
          subject: `Payment receipt ${p.receiptNumber} — ${company.companyName}`,
          text: `Dear ${inv.client.name},\n\nThank you. ${summary}\n\nRegards,\n${company.companyName}`,
          attachments: pdf ? [{ filename: `${p.receiptNumber}.pdf`, mimeType: "application/pdf", data: pdf }] : [],
          sender: "finance",
        });
        emailed = true;
      } catch (e) {
        errors.push(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (opts.whatsapp) {
    if (!inv.client.whatsapp) errors.push("Client has no WhatsApp number");
    else {
      const r = await sendWhatsapp({ to: inv.client.whatsapp, body: `Hi ${inv.client.name}, receipt ${p.receiptNumber}: ${summary} — ${company.companyName}` });
      if (r.ok) whatsapped = true;
      else errors.push(`WhatsApp failed: ${r.error}`);
    }
  }
  if (!emailed && !whatsapped) throw new Error(errors.join("; ") || "Receipt could not be sent");
  const receiptSentAt = new Date();
  await prisma.payment.update({ where: { id: p.id }, data: { receiptSentAt } });
  await audit(actorId, "payment.receipt_send", "Payment", p.id, { receiptSentAt: p.receiptSentAt }, { receiptSentAt, emailed, whatsapped, errors });
  return { receiptSentAt, emailed, whatsapped, errors };
}

export { invoiceBalance } from "@/server/finance/settlement";
