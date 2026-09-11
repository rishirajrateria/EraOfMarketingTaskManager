import { addMonths, subMonths } from "date-fns";
import type { BalanceMode, InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fmtDate, parseDateKey } from "@/lib/time";
import { round2 } from "@/server/finance/money";

/** Read models for the finance pages. Decimals are mapped to numbers; dates to ISO strings. */
export type ExpenseRow = {
  id: string;
  date: string;
  amount: number;
  category: string;
  vendor: string | null;
  note: string | null;
  tags: string[];
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
      id: true, date: true, amount: true, category: true, vendor: true, note: true, tags: true,
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

export type InvoiceRow = {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  status: InvoiceStatus;
  kind: "ONE_TIME" | "RECURRING";
  paymentMode: "FULL" | "ADVANCE";
  total: number;
  received: number;
  balance: number;
  dueDate: string | null;
  sentAt: string | null;
  sendAt: string | null;
  createdAt: string;
};

const invoiceSelect = {
  id: true, number: true, clientId: true, status: true, kind: true, paymentMode: true, total: true,
  dueDate: true, sentAt: true, sendAt: true, createdAt: true,
  client: { select: { name: true } },
  payments: { select: { amount: true } },
} satisfies Prisma.InvoiceSelect;

function toInvoiceRow(i: Prisma.InvoiceGetPayload<{ select: typeof invoiceSelect }>): InvoiceRow {
  const total = i.total.toNumber();
  const received = round2(i.payments.reduce((s, p) => s + p.amount.toNumber(), 0));
  return {
    id: i.id, number: i.number, clientId: i.clientId, clientName: i.client.name, status: i.status, kind: i.kind, paymentMode: i.paymentMode,
    total, received, balance: round2(Math.max(0, total - received)),
    dueDate: i.dueDate?.toISOString() ?? null, sentAt: i.sentAt?.toISOString() ?? null, sendAt: i.sendAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
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

export type InvoiceDetail = InvoiceRow & {
  clientEmail: string | null;
  gstPercent: number;
  subtotal: number;
  gstAmount: number;
  notes: string | null;
  paymentTerms: string | null;
  advancePercent: number | null;
  balanceMode: BalanceMode;
  balanceDueOn: string | null;
  balanceInvoice: { id: string; number: string } | null;
  /** The advance this invoice settles; its balanceMode tells whether this draft was generated automatically. */
  balanceOf: { id: string; number: string; balanceMode: BalanceMode } | null;
  reminderSentAt: string | null;
  reminderCount: number;
  schedule: { frequency: string; interval: number; nextRunAt: string | null; endDate: string | null; stopped: boolean } | null;
  items: { id: string; description: string; hsnSac: string | null; qty: number; unit: "HOURS" | "FIXED"; rate: number; amount: number }[];
  payments: { id: string; amount: number; receivedAt: string; method: string; reference: string | null; receiptNumber: string | null; receiptSentAt: string | null }[];
};

export async function getInvoiceDetail(id: string): Promise<InvoiceDetail | null> {
  const i = await prisma.invoice.findUnique({
    where: { id },
    include: {
      client: { select: { name: true, email: true } },
      items: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { receivedAt: "asc" } },
      schedule: true,
      balanceInvoice: { select: { id: true, number: true } },
      balanceOf: { select: { id: true, number: true, balanceMode: true } },
    },
  });
  if (!i) return null;
  const base = toInvoiceRow({ ...i, payments: i.payments.map((p) => ({ amount: p.amount })) });
  return {
    ...base,
    clientEmail: i.client.email,
    gstPercent: i.gstPercent.toNumber(),
    subtotal: i.subtotal.toNumber(),
    gstAmount: i.gstAmount.toNumber(),
    notes: i.notes,
    paymentTerms: i.paymentTerms,
    advancePercent: i.advancePercent,
    balanceMode: i.balanceMode,
    balanceDueOn: i.balanceDueOn?.toISOString() ?? null,
    balanceInvoice: i.balanceInvoice,
    balanceOf: i.balanceOf,
    reminderSentAt: i.reminderSentAt?.toISOString() ?? null,
    reminderCount: i.reminderCount,
    schedule: i.schedule
      ? { frequency: i.schedule.frequency, interval: i.schedule.interval, nextRunAt: i.schedule.nextRunAt?.toISOString() ?? null, endDate: i.schedule.endDate?.toISOString() ?? null, stopped: i.schedule.stopped }
      : null,
    items: i.items.map((it) => ({ id: it.id, description: it.description, hsnSac: it.hsnSac, qty: it.qty.toNumber(), unit: it.unit, rate: it.rate.toNumber(), amount: it.amount.toNumber() })),
    payments: i.payments.map((p) => ({ id: p.id, amount: p.amount.toNumber(), receivedAt: p.receivedAt.toISOString(), method: p.method, reference: p.reference, receiptNumber: p.receiptNumber, receiptSentAt: p.receiptSentAt?.toISOString() ?? null })),
  };
}

export async function listClientsForInvoice() {
  return prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } });
}

export type MonthSummary = { month: string; invoiced: number; received: number; expenses: number; net: number };
export type ClientSummary = { clientId: string; clientName: string; invoiced: number; received: number; outstanding: number };
export type FinanceSummary = {
  months: MonthSummary[];
  clients: ClientSummary[];
  totals: { invoiced: number; received: number; outstanding: number; expenses: number; net: number };
};

/** Invoiced vs received vs outstanding per client and per month (last 12 months), expenses per month, net (SPEC §11.4). */
export async function financeSummary(now = new Date()): Promise<FinanceSummary> {
  const tz = (await getSettings()).timezone;
  const since = parseDateKey(`${fmtDate(subMonths(now, 11), tz, "yyyy-MM")}-01`, tz);
  const [invoices, payments, expenses] = await Promise.all([
    prisma.invoice.findMany({ where: { status: { notIn: ["DRAFT", "SCHEDULED"] } }, select: { clientId: true, total: true, sentAt: true, createdAt: true, client: { select: { name: true } } } }),
    prisma.payment.findMany({ select: { amount: true, receivedAt: true, invoice: { select: { clientId: true } } } }),
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
    cl(i.clientId, i.client.name).invoiced += amt;
    const m = months.get(fmtDate(i.sentAt ?? i.createdAt, tz, "yyyy-MM"));
    if (m) m.invoiced += amt;
  }
  const clientNames = new Map(invoices.map((i) => [i.clientId, i.client.name]));
  for (const p of payments) {
    const amt = p.amount.toNumber();
    cl(p.invoice.clientId, clientNames.get(p.invoice.clientId) ?? "").received += amt;
    const m = months.get(fmtDate(p.receivedAt, tz, "yyyy-MM"));
    if (m) m.received += amt;
  }
  for (const e of expenses) {
    const m = months.get(fmtDate(e.date, tz, "yyyy-MM"));
    if (m) m.expenses += e.amount.toNumber();
  }
  const monthRows = Array.from(months.values()).map((m) => ({ ...m, invoiced: round2(m.invoiced), received: round2(m.received), expenses: round2(m.expenses), net: round2(m.received - m.expenses) }));
  const clientRows = Array.from(clients.values())
    .map((c) => ({ ...c, invoiced: round2(c.invoiced), received: round2(c.received), outstanding: round2(Math.max(0, c.invoiced - c.received)) }))
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
