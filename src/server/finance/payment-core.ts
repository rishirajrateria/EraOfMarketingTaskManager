import { Prisma, type Payment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminIds, notify } from "@/lib/notify";
import { sendMail } from "@/google/gmail";
import { allocateReceiptNumber } from "@/server/finance/numbering";
import { formatINRPlain, round2 } from "@/server/finance/money";
import { renderReceiptPdf } from "@/server/finance/pdf";
import { loadCompany } from "@/server/finance/invoice-core";
import { storeForClientAndFinance, toBytes } from "@/server/finance/drive-store";
import type { PaymentInput } from "@/server/finance/schemas";

export type RecordPaymentResult = { payment: Payment; status: "PAID" | "PARTIALLY_PAID"; balance: number; totalReceived: number };

/**
 * Record a payment against an invoice (SPEC §11.3 "Mark as paid"): Payment row with receipt number,
 * invoice status PAID / PARTIALLY_PAID, receipt PDF stored + uploaded to both Drive locations and
 * emailed to the client; admins notified when fully paid.
 */
export async function recordPaymentCore(input: PaymentInput, actorId: string | null, opts: { emailReceipt?: boolean } = {}): Promise<RecordPaymentResult> {
  const receivedAt = input.receivedAt ?? new Date();
  const tx = await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: input.invoiceId }, include: { client: true, payments: true } });
    if (!inv) throw new Error("Invoice not found");
    if (inv.status === "DRAFT" || inv.status === "SCHEDULED") throw new Error("Invoice has not been sent yet");
    const receiptNumber = await allocateReceiptNumber(tx);
    const payment = await tx.payment.create({
      data: { invoiceId: inv.id, amount: new Prisma.Decimal(round2(input.amount)), receivedAt, method: input.method, reference: input.reference, receiptNumber },
    });
    const totalReceived = round2(inv.payments.reduce((s, p) => s + p.amount.toNumber(), 0) + input.amount);
    const total = inv.total.toNumber();
    const status = totalReceived >= total - 0.005 ? "PAID" : "PARTIALLY_PAID";
    await tx.invoice.update({ where: { id: inv.id }, data: { status } });
    await audit(actorId, "invoice.payment", "Invoice", inv.id, { status: inv.status }, { status, amount: input.amount, receiptNumber }, tx);
    return { inv, payment, status, totalReceived, balance: round2(Math.max(0, total - totalReceived)) } as const;
  });

  const { inv, payment, status, totalReceived, balance } = tx;
  const company = await loadCompany();
  const pdf = await renderReceiptPdf(
    {
      receiptNumber: payment.receiptNumber!,
      receivedAt,
      amount: input.amount,
      method: input.method,
      reference: input.reference,
      invoiceNumber: inv.number,
      invoiceTotal: inv.total.toNumber(),
      totalReceived,
    },
    inv.client,
    company,
  );
  const fileName = `${payment.receiptNumber}.pdf`;
  const { clientFileId, backendFileId } = await storeForClientAndFinance(inv.client, "Receipts", { name: fileName, mimeType: "application/pdf", data: pdf });
  let receiptSentAt: Date | null = null;
  if (opts.emailReceipt !== false && inv.client.email) {
    await sendMail({
      to: inv.client.email,
      subject: `Payment receipt ${payment.receiptNumber} — ${company.companyName}`,
      text: `Dear ${inv.client.name},\n\nThank you. We have received ${formatINRPlain(input.amount)} against invoice ${inv.number}. Balance outstanding: ${formatINRPlain(balance)}.\n\nRegards,\n${company.companyName}`,
      attachments: [{ filename: fileName, mimeType: "application/pdf", data: pdf }],
    });
    receiptSentAt = new Date();
  }
  const saved = await prisma.payment.update({
    where: { id: payment.id },
    data: { receiptPdfData: toBytes(pdf), receiptPdfId: clientFileId, receiptBackendPdfId: backendFileId, receiptSentAt },
  });
  if (status === "PAID") {
    await notify({
      userIds: await adminIds(),
      kind: "INVOICE_PAID",
      title: `Invoice ${inv.number} paid in full by ${inv.client.name}`,
      body: formatINRPlain(totalReceived),
      href: `/admin/invoices/${inv.id}`,
    });
  }
  return { payment: saved, status, balance, totalReceived };
}

/** Balance outstanding for an invoice (total − payments). */
export async function invoiceBalance(invoiceId: string): Promise<number> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
  if (!inv) return 0;
  return round2(Math.max(0, inv.total.toNumber() - inv.payments.reduce((s, p) => s + p.amount.toNumber(), 0)));
}
