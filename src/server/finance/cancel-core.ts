import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fmtDate } from "@/lib/time";
import { sendMail } from "@/google/gmail";
import { sendWhatsapp } from "@/integrations/whatsapp";
import { formatINRPlain } from "@/server/finance/money";
import { loadCompany, loadInvoiceFull, toPdfInvoice, type InvoiceFull } from "@/server/finance/document-core";
import { updateFile } from "@/google/drive";
import { invoiceFileName } from "@/server/finance/file-names";
import { renderInvoicePdf } from "@/server/finance/pdf";
import { toBytes } from "@/server/finance/drive-store";
import { syncPartFromInvoice } from "@/server/finance/parts-core";
import { resumeWorkCore } from "@/server/finance/hold-work";
import { fileCancelledInvoice } from "@/server/finance/month-folders";
import { peekNextNumber } from "@/server/finance/numbering";

/**
 * Cancel a sent invoice (ADR 0009, prototype `cancelSheet`). Only an approved tax / export invoice that is SENT or
 * OVERDUE with no payments and no credit notes can be cancelled — otherwise a credit note reverses it. The number
 * stays used (the series counter is untouched, the next approval continues it). The invoice becomes CANCELLED with
 * the reason; pending plan parts are cancelled; a work hold tied to it is released; the PDF is re-rendered with a
 * CANCELLED stamp and filed under Finance/<issue month>/Cancelled invoices as "C Invoice No. … (<Client>).pdf" (the
 * Sales invoices copy is moved and renamed, ADR 0013); the client is told by email / WhatsApp when asked. Proformas
 * cannot be cancelled (ADR 0013).
 */
export type CancelOptions = { reason: string; email?: boolean; whatsapp?: boolean };
export type CancelResult = { id: string; number: string; nextNumber: string; emailed: boolean; whatsapped: boolean; errors: string[]; workResumed: boolean };

/**
 * The copies saved at approval (client folder, Finance/Invoices) are renamed to "C Invoice No. … (<Client>).pdf" and
 * replaced by the stamped PDF, so nobody forwards the live-looking original by mistake. Best effort.
 */
async function restampStoredCopies(inv: InvoiceFull, pdf: Buffer): Promise<void> {
  const name = invoiceFileName(inv, { cancelled: true });
  for (const fileId of [inv.pdfDriveFileId, inv.pdfBackendFileId]) {
    if (!fileId) continue;
    try {
      await updateFile({ fileId, name, mimeType: "application/pdf", data: pdf });
    } catch (e) {
      console.error("[cancel] rename failed", fileId, e instanceof Error ? e.message : e);
    }
  }
}

export const HAS_PAYMENTS_ERROR ="This invoice has payments. Use a credit note to reverse it.";
/** ADR 0013: a proforma is only handed over for reference; it is never a record, so there is nothing to cancel. */
export const PROFORMA_CANCEL_ERROR = "A proforma can't be cancelled. It is only an estimate and no record is kept of it, so there is nothing to cancel.";

/** Checked before the form is validated so a proforma always gets the clear message. */
export async function assertCancellableDocType(id: string): Promise<void> {
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { docType: true } });
  if (!inv) throw new Error("Invoice not found");
  if (inv.docType === "PROFORMA") throw new Error(PROFORMA_CANCEL_ERROR);
  if (inv.docType !== "TAX_INVOICE" && inv.docType !== "EXPORT_INVOICE") throw new Error("Only tax and export invoices can be cancelled");
}

export async function cancelInvoiceCore(id: string, opts: CancelOptions, actorId: string | null): Promise<CancelResult> {
  await assertCancellableDocType(id);
  const reason = opts.reason?.trim() ?? "";
  if (!reason) throw new Error("Write a short reason");
  if (reason.length > 500) throw new Error("Keep the reason under 500 characters");
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { client: true, payments: { select: { id: true } }, creditNotes: { where: { status: { not: "CANCELLED" } }, select: { id: true } } },
  });
  if (!inv) throw new Error("Invoice not found");
  if (inv.docType !== "TAX_INVOICE" && inv.docType !== "EXPORT_INVOICE") throw new Error("Only tax and export invoices can be cancelled");
  if (!inv.approvedAt) throw new Error("This invoice was never approved: delete the draft instead");
  if (inv.payments.length > 0 || inv.creditNotes.length > 0 || inv.status === "PARTIALLY_PAID" || inv.status === "PAID") throw new Error(HAS_PAYMENTS_ERROR);
  if (inv.status !== "SENT" && inv.status !== "OVERDUE") throw new Error(`A ${inv.status.toLowerCase().replace("_", " ")} invoice cannot be cancelled`);

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason, remindAt: null } });
    await syncPartFromInvoice(tx, id, "CANCELLED");
    if (inv.planId) {
      await tx.invoicePart.updateMany({ where: { planId: inv.planId, status: "PENDING" }, data: { status: "CANCELLED" } });
      const parts = await tx.invoicePart.findMany({ where: { planId: inv.planId }, select: { status: true } });
      if (!parts.some((p) => p.status === "PENDING" || p.status === "ISSUED")) {
        await tx.invoicePlan.update({ where: { id: inv.planId }, data: { status: parts.some((p) => p.status === "PAID") ? "COMPLETED" : "CANCELLED" } });
      }
    }
    await audit(actorId, "invoice.cancel", "Invoice", id, { status: inv.status, number: inv.number }, { status: "CANCELLED", reason, cancelledAt: now }, tx);
  });

  const workResumed = inv.client.workOnHold && inv.client.holdInvoiceId === id;
  if (workResumed) await resumeWorkCore(inv.clientId, actorId);

  // Stamped copy: stored for downloads and filed in Drive (best effort).
  const full = await loadInvoiceFull(id);
  const company = await loadCompany();
  let pdf: Buffer | null = null;
  try {
    pdf = await renderInvoicePdf(toPdfInvoice(full!), full!.client, company);
    await prisma.invoice.update({ where: { id }, data: { pdfData: toBytes(pdf) } });
    await fileCancelledInvoice(full!, pdf);
    await restampStoredCopies(full!, pdf);
  } catch (e) {
    console.error("[cancel] stamped PDF failed", id, e instanceof Error ? e.message : e);
  }
  const fileName = invoiceFileName(full ?? { ...inv, status: "CANCELLED" }, { cancelled: true });

  const errors: string[] = [];
  let emailed = false;
  let whatsapped = false;
  const total = formatINRPlain(inv.total.toNumber());
  const issued = fmtDate(inv.approvedAt, company.timezone, "d MMM yyyy");
  const text = `Dear ${inv.client.name},\n\nInvoice ${inv.number} dated ${issued} for ${total} has been cancelled.\nReason: ${reason}\n\nPlease disregard it; no payment is due against this invoice.\n\nRegards,\n${company.companyName}`;
  if (opts.email) {
    if (!inv.client.email) errors.push("Client has no email on file");
    else {
      try {
        await sendMail({ to: inv.client.email, subject: `Invoice ${inv.number} cancelled · ${company.companyName}`, text, attachments: pdf ? [{ filename: fileName, mimeType: "application/pdf", data: pdf }] : [], sender: "finance" });
        emailed = true;
      } catch (e) {
        errors.push(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (opts.whatsapp) {
    if (!inv.client.whatsapp) errors.push("Client has no WhatsApp number");
    else {
      const r = await sendWhatsapp({ to: inv.client.whatsapp, body: `${company.companyName}: invoice ${inv.number} (${total}) has been cancelled. Reason: ${reason}. No payment is due against it.` });
      if (r.ok) whatsapped = true;
      else errors.push(`WhatsApp failed: ${r.error}`);
    }
  }
  const nextNumber = await peekNextNumber(inv.docType);
  return { id, number: inv.number, nextNumber, emailed, whatsapped, errors, workResumed };
}
