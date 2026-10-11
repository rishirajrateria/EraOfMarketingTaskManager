import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminIds, notify } from "@/lib/notify";
import { fmtDate } from "@/lib/time";
import { sendMail } from "@/google/gmail";
import { sendWhatsapp } from "@/integrations/whatsapp";
import { allocateNumberFor, isDraftNumber } from "@/server/finance/numbering";
import { formatINRNumber, formatINRPlain } from "@/server/finance/money";
import { renderInvoicePdf } from "@/server/finance/pdf";
import { FULL_INCLUDE, loadCompany, loadInvoiceFull, toPdfInvoice, type CompanyInfo, type InvoiceFull } from "@/server/finance/document-core";
import { renderTemplate, storeForClientAndFinance, toBytes } from "@/server/finance/drive-store";
import { publicInvoiceUrl } from "@/server/finance/links";
import { invoiceFileName } from "@/server/finance/file-names";
import { fileSalesInvoice } from "@/server/finance/month-folders";
import { loadSettlement } from "@/server/finance/settlement";
import { applyCreditNoteEffect } from "@/server/finance/credit-notes";
import type { ApproveOptions } from "@/server/finance/schemas";

/**
 * Approve + send (ADR 0005): the only path that numbers a document and delivers it. Allocates the FY series number
 * (invoice / proforma / credit-note by docType), rotates the public token, renders + stores the PDF (Drive best
 * effort), emails and/or WhatsApps it, and sets SENT when at least one channel succeeded. With both channels off
 * the document is numbered and approved but stays AWAITING_APPROVAL. Re-sending never renumbers.
 */
export type ApproveResult = { id: string; number: string; status: string; emailed: boolean; whatsapped: boolean; errors: string[]; publicUrl: string | null };

const SENDABLE = ["DRAFT", "AWAITING_APPROVAL", "SENT", "OVERDUE", "PARTIALLY_PAID"] as const;
const DOC_LABEL = { TAX_INVOICE: "Invoice", EXPORT_INVOICE: "Invoice", PROFORMA: "Proforma invoice", CREDIT_NOTE: "Credit note" } as const;

export type TemplateVars = Record<"client" | "number" | "total" | "balance" | "dueDate" | "link" | "company", string>;

export async function templateVars(inv: InvoiceFull, company: CompanyInfo): Promise<TemplateVars> {
  const s = await loadSettlement(inv.id);
  return {
    client: inv.client.name,
    number: inv.number,
    total: formatINRNumber(inv.total.toNumber()),
    balance: formatINRNumber(s.balance),
    dueDate: inv.dueDate ? fmtDate(inv.dueDate, company.timezone, "d MMM yyyy") : "receipt",
    link: publicInvoiceUrl(inv.publicToken) ?? "",
    company: company.companyName,
  };
}

/** Number + approve + rotate the token inside one transaction; returns the refreshed invoice. */
async function approveRecord(inv: InvoiceFull, actorId: string | null, now: Date): Promise<InvoiceFull> {
  const token = randomBytes(32).toString("hex");
  return prisma.$transaction(async (tx) => {
    const number = isDraftNumber(inv.number) ? await allocateNumberFor(inv.docType, tx, now) : inv.number;
    const data = { number, publicToken: token, approvedAt: inv.approvedAt ?? now, approvedById: inv.approvedById ?? actorId };
    await tx.invoice.update({ where: { id: inv.id }, data });
    if (!inv.approvedAt) await audit(actorId, "invoice.approve", "Invoice", inv.id, { number: inv.number, status: inv.status }, { number, approvedAt: now }, tx);
    return tx.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: FULL_INCLUDE });
  });
}

async function deliver(inv: InvoiceFull, company: CompanyInfo, pdf: Buffer, opts: ApproveOptions) {
  const errors: string[] = [];
  let emailSentAt: Date | null = null;
  let whatsappSentAt: Date | null = null;
  let whatsappStatus: string | null = null;
  const vars = await templateVars(inv, company);
  const label = DOC_LABEL[inv.docType];
  if (opts.email) {
    if (!inv.client.email) errors.push("Client has no email on file");
    else {
      try {
        await sendMail({
          to: inv.client.email,
          subject: `${label} ${inv.number} from ${company.companyName}`,
          text: renderTemplate(opts.emailText ?? company.invoiceEmailTemplate, vars),
          attachments: [{ filename: invoiceFileName(inv), mimeType: "application/pdf", data: pdf }],
          sender: "finance", // invoices, proformas and credit notes go out from the finance mailbox (ADR 0018)
        });
        emailSentAt = new Date();
      } catch (e) {
        errors.push(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  if (opts.whatsapp) {
    if (!inv.client.whatsapp) errors.push("Client has no WhatsApp number");
    else {
      const r = await sendWhatsapp({ to: inv.client.whatsapp, body: renderTemplate(opts.whatsappText ?? company.invoiceWhatsappTemplate, vars), mediaUrl: vars.link || null });
      if (r.ok) {
        whatsappSentAt = new Date();
        whatsappStatus = `sent ${r.sid}`;
      } else {
        whatsappStatus = `failed: ${r.error}`;
        errors.push(`WhatsApp failed: ${r.error}`);
      }
    }
  }
  return { errors, emailSentAt, whatsappSentAt, whatsappStatus };
}

export async function approveAndSendCore(id: string, opts: ApproveOptions, actorId: string | null): Promise<ApproveResult> {
  const before = await loadInvoiceFull(id);
  if (!before) throw new Error("Invoice not found");
  if (!SENDABLE.includes(before.status as (typeof SENDABLE)[number])) throw new Error(`A ${before.status.toLowerCase().replace("_", " ")} document cannot be sent`);
  const now = new Date();
  const firstApproval = !before.approvedAt;
  const inv = await approveRecord(before, actorId, now);
  const company = await loadCompany();
  const pdf = await renderInvoicePdf(toPdfInvoice(inv), inv.client, company);
  const fileName = invoiceFileName(inv);
  // ADR 0013: a proforma is not a finance record — only the client folder gets a copy, never Finance/*.
  const financeSub = inv.docType === "PROFORMA" ? null : inv.docType === "CREDIT_NOTE" ? "CreditNotes" : "Invoices";
  const { clientFileId, backendFileId } = await storeForClientAndFinance(inv.client, financeSub, { name: fileName, mimeType: "application/pdf", data: pdf });
  await prisma.invoice.update({ where: { id }, data: { pdfData: toBytes(pdf), pdfDriveFileId: clientFileId, pdfBackendFileId: backendFileId } });
  await fileSalesInvoice(inv, pdf); // ADR 0009: Finance/<issue month>/Sales invoices (once)
  if (inv.docType === "CREDIT_NOTE" && firstApproval) await applyCreditNoteEffect(inv.id, actorId);

  const d = await deliver(inv, company, pdf, opts);
  const delivered = !!d.emailSentAt || !!d.whatsappSentAt;
  const status = delivered && (inv.status === "DRAFT" || inv.status === "AWAITING_APPROVAL") ? "SENT" : inv.status;
  await prisma.invoice.update({
    where: { id },
    data: {
      status,
      sentAt: inv.sentAt ?? (delivered ? now : null),
      ...(d.emailSentAt ? { emailSentAt: d.emailSentAt } : {}),
      ...(d.whatsappSentAt ? { whatsappSentAt: d.whatsappSentAt } : {}),
      ...(d.whatsappStatus ? { whatsappStatus: d.whatsappStatus } : {}),
    },
  });
  await audit(actorId, "invoice.send", "Invoice", id, { status: inv.status }, { status, emailed: !!d.emailSentAt, whatsapped: !!d.whatsappSentAt, errors: d.errors, clientFileId, backendFileId });
  if (delivered) {
    const via = [d.emailSentAt && "email", d.whatsappSentAt && "WhatsApp"].filter(Boolean).join(" + ");
    await notify({ userIds: await adminIds(), kind: "INVOICE_SENT", title: `${DOC_LABEL[inv.docType]} ${inv.number} sent to ${inv.client.name}`, body: `${formatINRPlain(inv.total.toNumber())} via ${via}`, href: `/admin/invoices/${id}`, invoiceId: id });
  }
  if ((opts.email || opts.whatsapp) && !delivered) throw new Error(`${inv.number} is approved but could not be sent: ${d.errors.join("; ")}`);
  return { id, number: inv.number, status, emailed: !!d.emailSentAt, whatsapped: !!d.whatsappSentAt, errors: d.errors, publicUrl: publicInvoiceUrl(inv.publicToken) };
}
