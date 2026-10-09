import { Prisma, type Client, type Invoice, type InvoiceItem, type InvoicePart, type InvoicePlan, type RecurrenceRule } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { lineAmount, round2 } from "@/server/finance/money";
import { renderInvoicePdf, type PdfCompany, type PdfInvoice } from "@/server/finance/pdf";
import { companyStateCode, effectiveGstPercent, resolveTax, splitTax, type DocType, type TaxMode } from "@/server/finance/tax";
import { DRAFT_PREFIX } from "@/server/finance/numbering";
import type { InvoiceItemInput } from "@/server/finance/schemas";

/**
 * Shared document plumbing for every invoice-like record (tax / export / proforma / credit note, ADR 0005):
 * line rows, tax split, the `DRAFT-<id>` placeholder number and PDF projection. No auth — callers check RBAC.
 */
export type InvoiceFull = Invoice & {
  items: InvoiceItem[];
  client: Client;
  schedule?: RecurrenceRule | null;
  planRef?: (InvoicePlan & { parts: Pick<InvoicePart, "seq" | "status">[] }) | null;
  creditNoteOf?: Pick<Invoice, "id" | "number"> | null;
};

export const FULL_INCLUDE = {
  items: true,
  client: true,
  schedule: true,
  planRef: { include: { parts: { select: { seq: true, status: true } } } },
  creditNoteOf: { select: { id: true, number: true } },
} satisfies Prisma.InvoiceInclude;

type Tx = Prisma.TransactionClient;
export const D = (n: number) => new Prisma.Decimal(round2(n));

export type ItemRow = { description: string; hsnSac: string | null; qty: number; unit: "HOURS" | "FIXED"; rate: number; amount: number };

export function rowsFromInput(items: InvoiceItemInput[]): ItemRow[] {
  return items.map((it) => ({ description: it.description, hsnSac: it.hsnSac ?? null, qty: it.qty, unit: it.unit, rate: it.rate, amount: lineAmount(it) }));
}

export function rowsFromModel(items: InvoiceItem[]): ItemRow[] {
  return items
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => ({ description: i.description, hsnSac: i.hsnSac, qty: i.qty.toNumber(), unit: i.unit, rate: i.rate.toNumber(), amount: i.amount.toNumber() }));
}

export const singleRow = (description: string, amount: number, hsnSac: string | null = null): ItemRow[] => [
  { description, hsnSac, qty: 1, unit: "FIXED", rate: round2(amount), amount: round2(amount) },
];

export const subtotalOf = (rows: ItemRow[]) => round2(rows.reduce((s, r) => s + r.amount, 0));

export type CompanyInfo = PdfCompany & {
  stateCode: string | null;
  timezone: string;
  invoiceEmailTemplate: string;
  invoiceWhatsappTemplate: string;
  reminderWhatsappTemplate: string;
  defaultGstPercent: number;
  invoiceTerms: string;
};

export async function loadCompany(): Promise<CompanyInfo> {
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
    lutNumber: s.lutNumber,
    logoData: s.logoData,
    stateCode: companyStateCode(s),
    timezone: s.timezone,
    invoiceEmailTemplate: s.invoiceEmailTemplate,
    invoiceWhatsappTemplate: s.invoiceWhatsappTemplate,
    reminderWhatsappTemplate: s.reminderWhatsappTemplate,
    defaultGstPercent: s.defaultGstPercent.toNumber(),
    invoiceTerms: s.invoiceTerms,
  };
}

/** Client + its tax resolution against the company state (ADR 0005). */
export async function loadClientTax(clientId: string, wanted?: DocType | null) {
  const [client, company] = await Promise.all([prisma.client.findUnique({ where: { id: clientId } }), loadCompany()]);
  if (!client) throw new Error("Client not found");
  return { client, company, tax: resolveTax({ companyStateCode: company.stateCode, client, wanted }) };
}

export type DocumentDraft = {
  clientId: string;
  docType: DocType;
  taxMode: TaxMode;
  placeOfSupply: string | null;
  plan: "ONE_TIME" | "RECURRING" | "PART";
  planId?: string | null;
  partSeq?: number | null;
  gstPercent: number;
  items: ItemRow[];
  description: string;
  dueDate: Date | null;
  notes?: string | null;
  paymentTerms?: string | null;
  scheduleId?: string | null;
  proformaOfId?: string | null;
  creditNoteOfId?: string | null;
};

/** Create the Invoice row as AWAITING_APPROVAL with number `DRAFT-<id>`; amounts from `splitTax`. */
export async function insertDocument(tx: Tx, draft: DocumentDraft, actorId: string | null, auditAction: string, auditExtra: Record<string, unknown> = {}): Promise<InvoiceFull> {
  const gstPercent = effectiveGstPercent(draft.gstPercent, draft.taxMode);
  const subtotal = subtotalOf(draft.items);
  const t = splitTax(subtotal, gstPercent, draft.taxMode);
  const created = await tx.invoice.create({
    data: {
      clientId: draft.clientId,
      number: `${DRAFT_PREFIX}pending-${Math.random().toString(36).slice(2)}`,
      docType: draft.docType,
      taxMode: draft.taxMode,
      placeOfSupply: draft.placeOfSupply,
      plan: draft.plan,
      planId: draft.planId ?? null,
      partSeq: draft.partSeq ?? null,
      kind: draft.plan === "RECURRING" ? "RECURRING" : "ONE_TIME",
      scheduleId: draft.scheduleId ?? null,
      proformaOfId: draft.proformaOfId ?? null,
      creditNoteOfId: draft.creditNoteOfId ?? null,
      description: draft.description,
      items: {
        create: draft.items.map((r, i) => ({ description: r.description, hsnSac: r.hsnSac, qty: D(r.qty), unit: r.unit, rate: D(r.rate), amount: D(r.amount), sortOrder: i })),
      },
      subtotal: D(subtotal),
      gstPercent: D(gstPercent),
      gstAmount: D(t.gstAmount),
      cgstAmount: D(t.cgst),
      sgstAmount: D(t.sgst),
      igstAmount: D(t.igst),
      total: D(t.total),
      notes: draft.notes ?? null,
      paymentTerms: draft.paymentTerms ?? null,
      dueDate: draft.dueDate,
      status: "AWAITING_APPROVAL",
    },
    select: { id: true },
  });
  const inv = await tx.invoice.update({ where: { id: created.id }, data: { number: `${DRAFT_PREFIX}${created.id}` }, include: FULL_INCLUDE });
  await audit(actorId, auditAction, "Invoice", inv.id, undefined, { docType: draft.docType, taxMode: draft.taxMode, plan: draft.plan, total: t.total, ...auditExtra }, tx);
  return inv;
}

export function partLabelFor(inv: Pick<InvoiceFull, "partSeq" | "planRef">): string | null {
  if (!inv.partSeq || !inv.planRef) return null;
  const active = inv.planRef.parts.filter((p) => p.status !== "MERGED" && p.status !== "CANCELLED").sort((a, b) => a.seq - b.seq);
  const index = active.findIndex((p) => p.seq === inv.partSeq) + 1;
  return `Part ${index || inv.partSeq} of ${Math.max(active.length, index)}`;
}

export function toPdfInvoice(inv: InvoiceFull): PdfInvoice {
  return {
    number: inv.number,
    issuedAt: inv.approvedAt ?? inv.sentAt ?? inv.createdAt,
    dueDate: inv.dueDate,
    docType: inv.docType,
    taxMode: inv.taxMode,
    placeOfSupply: inv.placeOfSupply,
    description: inv.description,
    partLabel: partLabelFor(inv),
    creditNoteOf: inv.creditNoteOf?.number ?? null,
    items: rowsFromModel(inv.items),
    subtotal: inv.subtotal.toNumber(),
    gstPercent: inv.gstPercent.toNumber(),
    gstAmount: inv.gstAmount.toNumber(),
    cgstAmount: inv.cgstAmount.toNumber(),
    sgstAmount: inv.sgstAmount.toNumber(),
    igstAmount: inv.igstAmount.toNumber(),
    total: inv.total.toNumber(),
    notes: inv.notes,
    paymentTerms: inv.paymentTerms,
    status: inv.status,
  };
}

export async function loadInvoiceFull(id: string): Promise<InvoiceFull | null> {
  return prisma.invoice.findUnique({ where: { id }, include: FULL_INCLUDE });
}

/** Generate PDF (for preview/download) without changing state. */
export async function renderInvoiceBuffer(inv: InvoiceFull): Promise<Buffer> {
  const company = await loadCompany();
  return renderInvoicePdf(toPdfInvoice(inv), inv.client, company);
}
