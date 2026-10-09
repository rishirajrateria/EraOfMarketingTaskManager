import { addMonths, subMonths } from "date-fns";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fmtDate, parseDateKey } from "@/lib/time";
import { round2 } from "@/server/finance/money";
import { publicInvoiceUrl } from "@/server/finance/links";
import { SETTLEMENT_INCLUDE, settleInvoice } from "@/server/finance/settlement";

/** Read models for the finance pages. Decimals are mapped to numbers; dates to ISO strings. */
export { awaitingApproval, clientLedger, paymentsDashboard } from "@/server/finance/dashboard-queries";
export type { AwaitingRow, ClientLedger, DashboardClientGroup, LedgerEntry, PaymentsDashboard } from "@/server/finance/dashboard-queries";

export type ExpenseRow = {
  id: string;
  date: string;
  amount: number;
  category: string;
  vendor: string | null;
  note: string | null;
  tags: string[];
  tdsApplied: boolean;
  tdsPercent: number | null;
  tdsAmount: number;
  hasReceipt: boolean;
  hasVoice: boolean;
  voiceDurationSec: number | null;
  receiptDriveId: string | null;
  createdBy: string;
};

export type ExpenseFilter = { month?: string | null; category?: string | null };

export function monthRange(month: string, tz: string) {
  const start = parseDateKey(`${month}-01`, tz);
  return { gte: start, lt: addMonths(start, 1) };
}

export async function expenseWhere(f: ExpenseFilter): Promise<Prisma.ExpenseWhereInput> {
  const tz = (await getSettings()).timezone;
  const where: Prisma.ExpenseWhereInput = {};
  if (f.month) where.date = monthRange(f.month, tz);
  if (f.category) where.category = { equals: f.category, mode: "insensitive" };
  return where;
}

export async function listExpenses(f: ExpenseFilter = {}): Promise<{ rows: ExpenseRow[]; total: number }> {
  const rows = await prisma.expense.findMany({
    where: await expenseWhere(f),
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      id: true, date: true, amount: true, category: true, vendor: true, note: true, tags: true, tdsApplied: true, tdsPercent: true, tdsAmount: true,
      receiptImageMime: true, receiptImageDriveId: true, voiceNoteDurationSec: true, voiceNoteDriveId: true,
      createdBy: { select: { name: true } },
    },
  });
  const mapped = rows.map<ExpenseRow>((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    amount: e.amount.toNumber(),
    category: e.category,
    vendor: e.vendor,
    note: e.note,
    tags: e.tags,
    tdsApplied: e.tdsApplied,
    tdsPercent: e.tdsPercent?.toNumber() ?? null,
    tdsAmount: e.tdsAmount.toNumber(),
    hasReceipt: !!e.receiptImageMime,
    hasVoice: e.voiceNoteDurationSec != null || !!e.voiceNoteDriveId,
    voiceDurationSec: e.voiceNoteDurationSec,
    receiptDriveId: e.receiptImageDriveId,
    createdBy: e.createdBy.name,
  }));
  return { rows: mapped, total: round2(mapped.reduce((s, r) => s + r.amount, 0)) };
}

export async function expenseCategories(): Promise<string[]> {
  const rows = await prisma.expense.groupBy({ by: ["category"], _count: { _all: true }, orderBy: { _count: { category: "desc" } } });
  return rows.map((r) => r.category);
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export type InvoiceRow = {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  status: InvoiceStatus;
  docType: "TAX_INVOICE" | "EXPORT_INVOICE" | "PROFORMA" | "CREDIT_NOTE";
  taxMode: "CGST_SGST" | "IGST" | "EXPORT_LUT" | "NONE";
  plan: "ONE_TIME" | "RECURRING" | "PART";
  partSeq: number | null;
  total: number;
  /** ISO 4217 (ADR 0007); "INR" unless an export invoice was raised in a foreign currency. */
  currency: string;
  received: number;
  tds: number;
  credited: number;
  balance: number;
  dueDate: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  remindAt: string | null;
  createdAt: string;
};

export const invoiceSelect = {
  id: true, number: true, clientId: true, status: true, docType: true, taxMode: true, plan: true, partSeq: true, total: true, currency: true,
  dueDate: true, approvedAt: true, sentAt: true, remindAt: true, createdAt: true,
  client: { select: { name: true } },
  ...SETTLEMENT_INCLUDE,
} satisfies Prisma.InvoiceSelect;

export function toInvoiceRow(i: Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>): InvoiceRow {
  const s = settleInvoice(i);
  return {
    id: i.id, number: i.number, clientId: i.clientId, clientName: i.client.name, status: i.status, docType: i.docType, taxMode: i.taxMode, plan: i.plan, partSeq: i.partSeq,
    total: i.total.toNumber(), currency: i.currency, received: s.received, tds: s.tds, credited: s.credited, balance: s.balance,
    dueDate: iso(i.dueDate), approvedAt: iso(i.approvedAt), sentAt: iso(i.sentAt), remindAt: iso(i.remindAt), createdAt: i.createdAt.toISOString(),
  };
}

export async function listInvoices(f: { status?: InvoiceStatus | null; clientId?: string | null } = {}): Promise<InvoiceRow[]> {
  const rows = await prisma.invoice.findMany({
    where: { ...(f.status ? { status: f.status } : {}), ...(f.clientId ? { clientId: f.clientId } : {}) },
    orderBy: { createdAt: "desc" },
    select: invoiceSelect,
  });
  return rows.map(toInvoiceRow);
}

type DocRef = { id: string; number: string; status: InvoiceStatus };

export type InvoiceDetail = InvoiceRow & {
  client: { email: string | null; phone: string | null; whatsapp: string | null; gstNumber: string | null; tdsPercent: number | null; workOnHold: boolean; holdInvoiceId: string | null; holdSince: string | null };
  /** ADR 0006: the client deducts TDS on this invoice (drives the payment sheet defaults). */
  tdsApplicable: boolean;
  gstPercent: number;
  subtotal: number;
  gstAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  placeOfSupply: string | null;
  description: string;
  notes: string | null;
  paymentTerms: string | null;
  emailSentAt: string | null;
  whatsappSentAt: string | null;
  whatsappStatus: string | null;
  publicUrl: string | null;
  cancelledAt: string | null;
  reminderSentAt: string | null;
  reminderCount: number;
  schedule: { frequency: string; interval: number; monthAnchor: string; dayOfMonth: number | null; notifyMinutes: number; nextRunAt: string | null; endDate: string | null; stopped: boolean } | null;
  planRef: {
    id: string;
    title: string;
    totalAmount: number;
    gstPercent: number;
    status: string;
    parts: { seq: number; kind: string; value: number; amount: number; dueDate: string; status: string; description: string; invoice: DocRef | null }[];
  } | null;
  creditNotes: { id: string; number: string; status: InvoiceStatus; total: number; approvedAt: string | null; description: string }[];
  creditNoteOf: { id: string; number: string } | null;
  convertedTo: DocRef | null;
  proformaOf: { id: string; number: string } | null;
  items: { id: string; description: string; hsnSac: string | null; qty: number; unit: "HOURS" | "FIXED"; rate: number; amount: number }[];
  payments: { id: string; amount: number; tdsAmount: number; tdsPercent: number | null; receivedAt: string; method: string; reference: string | null; notes: string | null; receiptNumber: string | null; receiptSentAt: string | null }[];
};

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const i = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: { select: { name: true, email: true, phone: true, whatsapp: true, gstNumber: true, tdsPercent: true, workOnHold: true, holdInvoiceId: true, holdSince: true } },
      items: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { receivedAt: "asc" } },
      schedule: true,
      planRef: { include: { parts: { orderBy: { seq: "asc" } } } },
      creditNotes: { orderBy: { createdAt: "asc" }, select: { id: true, number: true, status: true, total: true, approvedAt: true, description: true } },
      creditNoteOf: { select: { id: true, number: true } },
      convertedTo: { select: { id: true, number: true, status: true } },
      proformaOf: { select: { id: true, number: true } },
    },
  });
  if (!i) return null;
  const approvedNotes = i.creditNotes.filter((c) => c.approvedAt && c.status !== "CANCELLED");
  const base = toInvoiceRow({ ...i, payments: i.payments.map((p) => ({ amount: p.amount, tdsAmount: p.tdsAmount })), creditNotes: approvedNotes.map((c) => ({ total: c.total })) });
  const partInvoices = i.planRef ? await prisma.invoice.findMany({ where: { planId: i.planRef.id }, select: { id: true, number: true, status: true, partSeq: true } }) : [];
  return {
    ...base,
    client: { email: i.client.email, phone: i.client.phone, whatsapp: i.client.whatsapp, gstNumber: i.client.gstNumber, tdsPercent: i.client.tdsPercent?.toNumber() ?? null, workOnHold: i.client.workOnHold, holdInvoiceId: i.client.holdInvoiceId, holdSince: iso(i.client.holdSince) },
    tdsApplicable: i.tdsApplicable,
    gstPercent: i.gstPercent.toNumber(),
    subtotal: i.subtotal.toNumber(),
    gstAmount: i.gstAmount.toNumber(),
    cgstAmount: i.cgstAmount.toNumber(),
    sgstAmount: i.sgstAmount.toNumber(),
    igstAmount: i.igstAmount.toNumber(),
    placeOfSupply: i.placeOfSupply,
    description: i.description,
    notes: i.notes,
    paymentTerms: i.paymentTerms,
    emailSentAt: iso(i.emailSentAt),
    whatsappSentAt: iso(i.whatsappSentAt),
    whatsappStatus: i.whatsappStatus,
    publicUrl: publicInvoiceUrl(i.publicToken),
    cancelledAt: iso(i.cancelledAt),
    reminderSentAt: iso(i.reminderSentAt),
    reminderCount: i.reminderCount,
    schedule: i.schedule
      ? { frequency: i.schedule.frequency, interval: i.schedule.interval, monthAnchor: i.schedule.monthAnchor, dayOfMonth: i.schedule.dayOfMonth, notifyMinutes: i.schedule.notifyMinutes, nextRunAt: iso(i.schedule.nextRunAt), endDate: iso(i.schedule.endDate), stopped: i.schedule.stopped }
      : null,
    planRef: i.planRef
      ? {
          id: i.planRef.id,
          title: i.planRef.title,
          totalAmount: i.planRef.totalAmount.toNumber(),
          gstPercent: i.planRef.gstPercent.toNumber(),
          status: i.planRef.status,
          parts: i.planRef.parts.map((p) => {
            const inv = partInvoices.find((x) => x.id === p.invoiceId) ?? null;
            return { seq: p.seq, kind: p.kind, value: p.value.toNumber(), amount: p.amount.toNumber(), dueDate: p.dueDate.toISOString(), status: p.status, description: p.description, invoice: inv ? { id: inv.id, number: inv.number, status: inv.status } : null };
          }),
        }
      : null,
    creditNotes: i.creditNotes.map((c) => ({ id: c.id, number: c.number, status: c.status, total: c.total.toNumber(), approvedAt: iso(c.approvedAt), description: c.description })),
    creditNoteOf: i.creditNoteOf,
    convertedTo: i.convertedTo,
    proformaOf: i.proformaOf,
    items: i.items.map((it) => ({ id: it.id, description: it.description, hsnSac: it.hsnSac, qty: it.qty.toNumber(), unit: it.unit, rate: it.rate.toNumber(), amount: it.amount.toNumber() })),
    payments: i.payments.map((p) => ({ id: p.id, amount: p.amount.toNumber(), tdsAmount: p.tdsAmount.toNumber(), tdsPercent: p.tdsPercent?.toNumber() ?? null, receivedAt: p.receivedAt.toISOString(), method: p.method, reference: p.reference, notes: p.notes, receiptNumber: p.receiptNumber, receiptSentAt: iso(p.receiptSentAt) })),
  };
}

export async function listClientsForInvoice() {
  const rows = await prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, whatsapp: true, country: true, currency: true, stateCode: true, stateName: true, gstNumber: true, tdsPercent: true, workOnHold: true } });
  return rows.map((c) => ({ ...c, tdsPercent: c.tdsPercent?.toNumber() ?? null }));
}

export type MonthSummary = { month: string; invoiced: number; received: number; expenses: number; net: number };
export type ClientSummary = { clientId: string; clientName: string; invoiced: number; received: number; outstanding: number };
export type FinanceSummary = {
  months: MonthSummary[];
  clients: ClientSummary[];
  totals: { invoiced: number; received: number; outstanding: number; expenses: number; net: number };
};

/** Approved tax / export invoices that still count (not cancelled). */
export const BILLED_WHERE = { docType: { in: ["TAX_INVOICE", "EXPORT_INVOICE"] }, approvedAt: { not: null }, status: { not: "CANCELLED" } } satisfies Prisma.InvoiceWhereInput;

/** Invoiced vs received vs outstanding per client and per month (last 12 months), expenses per month, net (SPEC §11.4). */
export async function financeSummary(now = new Date()): Promise<FinanceSummary> {
  const tz = (await getSettings()).timezone;
  const since = parseDateKey(`${fmtDate(subMonths(now, 11), tz, "yyyy-MM")}-01`, tz);
  const [invoices, payments, expenses] = await Promise.all([
    prisma.invoice.findMany({ where: BILLED_WHERE, select: { clientId: true, total: true, approvedAt: true, sentAt: true, createdAt: true, client: { select: { name: true } }, ...SETTLEMENT_INCLUDE } }),
    prisma.payment.findMany({ select: { amount: true, receivedAt: true, invoice: { select: { clientId: true, client: { select: { name: true } } } } } }),
    prisma.expense.findMany({ where: { date: { gte: since } }, select: { amount: true, date: true } }),
  ]);
  const months = new Map<string, MonthSummary>();
  for (let k = 11; k >= 0; k--) {
    const key = fmtDate(subMonths(now, k), tz, "yyyy-MM");
    months.set(key, { month: key, invoiced: 0, received: 0, expenses: 0, net: 0 });
  }
  const clients = new Map<string, ClientSummary>();
  const cl = (id: string, name: string) => clients.get(id) ?? clients.set(id, { clientId: id, clientName: name, invoiced: 0, received: 0, outstanding: 0 }).get(id)!;
  for (const i of invoices) {
    const amt = i.total.toNumber();
    const c = cl(i.clientId, i.client.name);
    c.invoiced += amt;
    c.outstanding += settleInvoice(i).balance;
    const m = months.get(fmtDate(i.approvedAt ?? i.sentAt ?? i.createdAt, tz, "yyyy-MM"));
    if (m) m.invoiced += amt;
  }
  for (const p of payments) {
    const amt = p.amount.toNumber();
    cl(p.invoice.clientId, p.invoice.client.name).received += amt;
    const m = months.get(fmtDate(p.receivedAt, tz, "yyyy-MM"));
    if (m) m.received += amt;
  }
  for (const e of expenses) {
    const m = months.get(fmtDate(e.date, tz, "yyyy-MM"));
    if (m) m.expenses += e.amount.toNumber();
  }
  const monthRows = Array.from(months.values()).map((m) => ({ ...m, invoiced: round2(m.invoiced), received: round2(m.received), expenses: round2(m.expenses), net: round2(m.received - m.expenses) }));
  const clientRows = Array.from(clients.values())
    .map((c) => ({ ...c, invoiced: round2(c.invoiced), received: round2(c.received), outstanding: round2(c.outstanding) }))
    .sort((a, b) => b.invoiced - a.invoiced);
  const totals = {
    invoiced: round2(clientRows.reduce((s, c) => s + c.invoiced, 0)),
    received: round2(clientRows.reduce((s, c) => s + c.received, 0)),
    outstanding: round2(clientRows.reduce((s, c) => s + c.outstanding, 0)),
    expenses: round2(monthRows.reduce((s, m) => s + m.expenses, 0)),
    net: 0,
  };
  totals.net = round2(totals.received - totals.expenses);
  return { months: monthRows, clients: clientRows, totals };
}
