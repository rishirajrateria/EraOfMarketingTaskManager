import { Prisma, type Invoice, type InvoiceItem, type Client, type RecurrenceRule } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { adminIds, notify } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { sendMail } from "@/google/gmail";
import { allocateInvoiceNumber } from "@/server/finance/numbering";
import { computeTotals, formatINRNumber, formatINRPlain, lineAmount, round2 } from "@/server/finance/money";
import { renderInvoicePdf, type PdfCompany, type PdfInvoice } from "@/server/finance/pdf";
import { nextOccurrence, shiftedDueDate } from "@/server/finance/recurrence";
import { renderTemplate, storeForClientAndFinance, toBytes } from "@/server/finance/drive-store";
import type { InvoiceInput } from "@/server/finance/schemas";

/** Core invoice logic without auth — called by server actions (after RBAC) and by the invoices job. */
export type InvoiceFull = Invoice & { items: InvoiceItem[]; client: Client; schedule?: RecurrenceRule | null };

type Tx = Prisma.TransactionClient;
const D = (n: number) => new Prisma.Decimal(round2(n));

export async function loadCompany(): Promise<PdfCompany & { invoiceEmailTemplate: string; timezone: string }> {
  const s = await getSettings();
  return {
    companyName: s.companyName,
    address: s.address,
    gstNumber: s.gstNumber,
    bankName: s.bankName,
    bankAccountName: s.bankAccountName,
    bankAccountNumber: s.bankAccountNumber,
    bankIfsc: s.bankIfsc,
    upiId: s.upiId,
    logoData: s.logoData,
    invoiceEmailTemplate: s.invoiceEmailTemplate,
    timezone: s.timezone,
  };
}

type ItemRow = { description: string; hsnSac: string | null; qty: number; unit: "HOURS" | "FIXED"; rate: number; amount: number };

/** Advance mode collapses the full-amount lines into one derived line worth advancePercent of the sum. */
export function buildItemRows(input: Pick<InvoiceInput, "items" | "paymentMode" | "advancePercent">): ItemRow[] {
  const rows: ItemRow[] = input.items.map((it) => ({
    description: it.description,
    hsnSac: it.hsnSac ?? null,
    qty: it.qty,
    unit: it.unit,
    rate: it.rate,
    amount: lineAmount(it),
  }));
  if (input.paymentMode !== "ADVANCE") return rows;
  const pct = input.advancePercent ?? 50;
  const full = round2(rows.reduce((s, r) => s + r.amount, 0));
  const summary = rows.map((r) => r.description).join("; ").slice(0, 300);
  const amount = round2((full * pct) / 100);
  return [{ description: `Advance ${pct}% of ${formatINRPlain(full)} (${summary})`, hsnSac: rows[0]?.hsnSac ?? null, qty: 1, unit: "FIXED", rate: amount, amount }];
}

function itemsCreate(rows: ItemRow[]) {
  return rows.map((r, i) => ({
    description: r.description,
    hsnSac: r.hsnSac,
    qty: D(r.qty),
    unit: r.unit,
    rate: D(r.rate),
    amount: D(r.amount),
    sortOrder: i,
  }));
}

export async function createInvoiceRecord(input: InvoiceInput, actorId: string | null): Promise<InvoiceFull> {
  const settings = await getSettings();
  const client = await prisma.client.findUnique({ where: { id: input.clientId } });
  if (!client) throw new Error("Client not found");
  if (input.paymentMode === "ADVANCE" && !input.advancePercent) throw new Error("advance % required for ADVANCE mode");
  if (input.kind === "RECURRING" && !input.recurrence) throw new Error("recurrence rule required for RECURRING invoices");
  const gstPercent = input.gstPercent ?? settings.defaultGstPercent.toNumber();
  const rows = buildItemRows(input);
  const t = computeTotals(rows.map((r) => ({ qty: 1, unit: "FIXED" as const, rate: r.amount })), gstPercent);
  const now = new Date();
  const status = input.sendAt && input.sendAt > now ? "SCHEDULED" : "DRAFT";

  const created = await prisma.$transaction(async (tx) => {
    const number = await allocateInvoiceNumber(tx);
    let scheduleId: string | undefined;
    if (input.kind === "RECURRING" && input.recurrence) {
      const r = input.recurrence;
      const rule = await tx.recurrenceRule.create({
        data: {
          frequency: r.frequency,
          interval: r.interval,
          byWeekday: r.byWeekday,
          endDate: r.endDate,
          trigger: "ON_SCHEDULE",
          nextRunAt: nextOccurrence(input.sendAt ?? now, r),
        },
      });
      scheduleId = rule.id;
    }
    const inv = await tx.invoice.create({
      data: {
        clientId: client.id,
        number,
        items: { create: itemsCreate(rows) },
        subtotal: D(t.subtotal),
        gstPercent: D(gstPercent),
        gstAmount: D(t.gstAmount),
        total: D(t.total),
        kind: input.kind,
        scheduleId,
        paymentMode: input.paymentMode,
        advancePercent: input.paymentMode === "ADVANCE" ? input.advancePercent : null,
        balanceDueOn: input.paymentMode === "ADVANCE" ? input.balanceDueOn : null,
        notes: input.notes,
        paymentTerms: input.paymentTerms ?? settings.invoiceTerms,
        dueDate: input.dueDate,
        sendAt: input.sendAt,
        status,
      },
      include: { items: true, client: true, schedule: true },
    });
    await audit(actorId, "invoice.create", "Invoice", inv.id, undefined, { number, status, total: t.total }, tx);
    return inv;
  });
  return created;
}

export function toPdfInvoice(inv: InvoiceFull): PdfInvoice {
  return {
    number: inv.number,
    issuedAt: inv.sentAt ?? inv.createdAt,
    dueDate: inv.dueDate,
    items: inv.items
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({ description: i.description, hsnSac: i.hsnSac, qty: i.qty.toNumber(), unit: i.unit, rate: i.rate.toNumber(), amount: i.amount.toNumber() })),
    subtotal: inv.subtotal.toNumber(),
    gstPercent: inv.gstPercent.toNumber(),
    gstAmount: inv.gstAmount.toNumber(),
    total: inv.total.toNumber(),
    notes: inv.notes,
    paymentTerms: inv.paymentTerms,
    status: inv.status,
  };
}

export async function loadInvoiceFull(id: string): Promise<InvoiceFull | null> {
  return prisma.invoice.findUnique({ where: { id }, include: { items: true, client: true, schedule: true } });
}

/** Generate PDF (for preview/download) without changing state. */
export async function renderInvoiceBuffer(inv: InvoiceFull): Promise<Buffer> {
  const company = await loadCompany();
  return renderInvoicePdf(toPdfInvoice(inv), inv.client, company);
}

/**
 * Send an invoice: PDF → pdfData, Drive (client folder + Finance/Invoices), Gmail with attachment,
 * status SENT, admins notified. Idempotent: an invoice that is already sent is returned untouched.
 */
export async function sendInvoiceCore(id: string, actorId: string | null): Promise<InvoiceFull> {
  const inv = await loadInvoiceFull(id);
  if (!inv) throw new Error("Invoice not found");
  if (inv.status !== "DRAFT" && inv.status !== "SCHEDULED") return inv;
  const company = await loadCompany();
  const sentAt = new Date();
  const pdf = await renderInvoicePdf(toPdfInvoice({ ...inv, sentAt }), inv.client, company);
  const fileName = `${inv.number}.pdf`;
  const { clientFileId, backendFileId } = await storeForClientAndFinance(inv.client, "Invoices", { name: fileName, mimeType: "application/pdf", data: pdf });

  let emailed = false;
  if (inv.client.email) {
    const vars = {
      client: inv.client.name,
      number: inv.number,
      total: formatINRNumber(inv.total.toNumber()),
      dueDate: inv.dueDate ? fmtDate(inv.dueDate, company.timezone, "d MMM yyyy") : "receipt",
      company: company.companyName,
    };
    await sendMail({
      to: inv.client.email,
      subject: `Invoice ${inv.number} from ${company.companyName}`,
      text: renderTemplate(company.invoiceEmailTemplate, vars),
      attachments: [{ filename: fileName, mimeType: "application/pdf", data: pdf }],
    });
    emailed = true;
  }
  const updated = await prisma.invoice.update({
    where: { id },
    data: { status: "SENT", sentAt, pdfData: toBytes(pdf), pdfDriveFileId: clientFileId, pdfBackendFileId: backendFileId },
    include: { items: true, client: true, schedule: true },
  });
  await audit(actorId, "invoice.send", "Invoice", id, { status: inv.status }, { status: "SENT", emailed, clientFileId, backendFileId });
  await notify({
    userIds: await adminIds(),
    kind: "INVOICE_SENT",
    title: `Invoice ${inv.number} sent to ${inv.client.name}`,
    body: `${formatINRPlain(inv.total.toNumber())}${emailed ? "" : " (client has no email — not emailed)"}`,
    href: `/admin/invoices/${id}`,
  });
  return updated;
}

/** Balance invoice for an ADVANCE invoice: remaining (100 − advance)% of the full amount. Idempotent. */
export async function generateBalanceInvoiceCore(advanceId: string, actorId: string | null, send = true): Promise<InvoiceFull> {
  const adv = await prisma.invoice.findUnique({ where: { id: advanceId }, include: { items: true, client: true, balanceInvoice: { select: { id: true } } } });
  if (!adv) throw new Error("Invoice not found");
  if (adv.paymentMode !== "ADVANCE" || !adv.advancePercent) throw new Error("Not an advance invoice");
  if (adv.balanceInvoice) return (await loadInvoiceFull(adv.balanceInvoice.id))!;
  const pct = adv.advancePercent;
  const full = round2(adv.subtotal.toNumber() / (pct / 100));
  const remaining = round2(full - adv.subtotal.toNumber());
  const gst = adv.gstPercent.toNumber();
  const t = computeTotals([{ qty: 1, unit: "FIXED", rate: remaining }], gst);
  const issuedAt = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const number = await allocateInvoiceNumber(tx);
    const inv = await tx.invoice.create({
      data: {
        clientId: adv.clientId,
        number,
        items: { create: itemsCreate([{ description: `Balance ${100 - pct}% of ${formatINRPlain(full)} (against ${adv.number})`, hsnSac: adv.items[0]?.hsnSac ?? null, qty: 1, unit: "FIXED", rate: remaining, amount: remaining }]) },
        subtotal: D(t.subtotal),
        gstPercent: D(gst),
        gstAmount: D(t.gstAmount),
        total: D(t.total),
        kind: "ONE_TIME",
        paymentMode: "FULL",
        balanceOfId: adv.id,
        notes: adv.notes,
        paymentTerms: adv.paymentTerms,
        dueDate: shiftedDueDate(adv.sentAt ?? adv.createdAt, adv.dueDate, issuedAt),
        status: "DRAFT",
      },
      include: { items: true, client: true, schedule: true },
    });
    await audit(actorId, "invoice.balance_generate", "Invoice", inv.id, undefined, { number, of: adv.number, total: t.total }, tx);
    return inv;
  });
  return send ? sendInvoiceCore(created.id, actorId) : created;
}

/** Next occurrence of a RECURRING template: same client/items/terms, new number, shifted due date. */
export async function cloneRecurringOccurrence(template: InvoiceFull, occurrenceAt: Date, actorId: string | null): Promise<InvoiceFull> {
  const rows: ItemRow[] = template.items.map((i) => ({ description: i.description, hsnSac: i.hsnSac, qty: i.qty.toNumber(), unit: i.unit, rate: i.rate.toNumber(), amount: i.amount.toNumber() }));
  return prisma.$transaction(async (tx: Tx) => {
    const number = await allocateInvoiceNumber(tx);
    const inv = await tx.invoice.create({
      data: {
        clientId: template.clientId,
        number,
        items: { create: itemsCreate(rows) },
        subtotal: template.subtotal,
        gstPercent: template.gstPercent,
        gstAmount: template.gstAmount,
        total: template.total,
        kind: "RECURRING",
        scheduleId: template.scheduleId,
        paymentMode: "FULL",
        notes: template.notes,
        paymentTerms: template.paymentTerms,
        dueDate: shiftedDueDate(template.sentAt ?? template.sendAt ?? template.createdAt, template.dueDate, occurrenceAt),
        status: "DRAFT",
      },
      include: { items: true, client: true, schedule: true },
    });
    await audit(actorId, "invoice.recur_generate", "Invoice", inv.id, undefined, { number, template: template.number }, tx);
    return inv;
  });
}
