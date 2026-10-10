import { addDays } from "date-fns";
import type { InvoiceStatus, PaymentMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fmtDate, parseDateKey } from "@/lib/time";
import { round2 } from "@/server/finance/money";
import { SETTLEMENT_INCLUDE, settleInvoice } from "@/server/finance/settlement";

/** Payments dashboard, approval queue and client ledger (ADR 0005). Plain numbers / ISO strings only. */
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const BILLED_DOCS = ["TAX_INVOICE", "EXPORT_INVOICE"] as const;
const OPEN_STATUSES: InvoiceStatus[] = ["SENT", "PARTIALLY_PAID", "OVERDUE"];

export type AwaitingRow = { id: string; number: string; clientId: string; clientName: string; docType: string; plan: string; partSeq: number | null; total: number; dueDate: string | null; remindAt: string | null; createdAt: string };

/** Documents waiting for Admin's approval (the confirm-sheet queue). */
export async function awaitingApproval(): Promise<AwaitingRow[]> {
  const rows = await prisma.invoice.findMany({
    where: { status: "AWAITING_APPROVAL", approvedAt: null },
    orderBy: [{ remindAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    select: { id: true, number: true, clientId: true, docType: true, plan: true, partSeq: true, total: true, dueDate: true, remindAt: true, createdAt: true, client: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, number: r.number, clientId: r.clientId, clientName: r.client.name, docType: r.docType, plan: r.plan, partSeq: r.partSeq, total: r.total.toNumber(), dueDate: iso(r.dueDate), remindAt: iso(r.remindAt), createdAt: r.createdAt.toISOString() }));
}

export type DashboardInvoice = { id: string; number: string; status: InvoiceStatus; dueDate: string | null; total: number; balance: number };
export type DashboardClientGroup = { clientId: string; clientName: string; balance: number; invoices: DashboardInvoice[] };

export type PaymentsDashboard = {
  month: string;
  tiles: { outstanding: number; overdue: number; receivedThisMonth: number; awaitingApproval: number; awaitingApprovalCount: number };
  dueSoon: DashboardClientGroup[];
  overdue: DashboardClientGroup[];
  outstandingByClient: { clientId: string; clientName: string; balance: number; onHold: boolean }[];
  upcoming: {
    parts: { planId: string; seq: number; clientId: string; clientName: string; title: string; amount: number; dueDate: string }[];
    recurrences: { ruleId: string; invoiceId: string; clientName: string; number: string; total: number; nextRunAt: string }[];
  };
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
  payments: { id: string; receivedAt: string; amount: number; tdsAmount: number; method: PaymentMethod; invoiceId: string; invoiceNumber: string; clientName: string; receiptNumber: string | null; receiptSentAt: string | null }[];
};

type OpenRow = Prisma.InvoiceGetPayload<{ select: { id: true; number: true; status: true; dueDate: true; total: true; clientId: true; client: { select: { name: true; workOnHold: true } } } & typeof SETTLEMENT_INCLUDE }>;

function groupByClient(rows: (OpenRow & { balance: number })[]): DashboardClientGroup[] {
  const map = new Map<string, DashboardClientGroup>();
  for (const r of rows) {
    const g = map.get(r.clientId) ?? { clientId: r.clientId, clientName: r.client.name, balance: 0, invoices: [] };
    g.balance = round2(g.balance + r.balance);
    g.invoices.push({ id: r.id, number: r.number, status: r.status, dueDate: iso(r.dueDate), total: r.total.toNumber(), balance: r.balance });
    map.set(r.clientId, g);
  }
  return Array.from(map.values()).sort((a, b) => b.balance - a.balance);
}

export async function paymentsDashboard(f: { month?: string | null; method?: PaymentMethod | null } = {}, now = new Date()): Promise<PaymentsDashboard> {
  const tz = (await getSettings()).timezone;
  const month = f.month ?? fmtDate(now, tz, "yyyy-MM");
  const start = parseDateKey(`${month}-01`, tz);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const [open, awaiting, monthPayments, parts, rules] = await Promise.all([
    prisma.invoice.findMany({
      where: { docType: { in: [...BILLED_DOCS] }, status: { in: OPEN_STATUSES } },
      select: { id: true, number: true, status: true, dueDate: true, total: true, clientId: true, client: { select: { name: true, workOnHold: true } }, ...SETTLEMENT_INCLUDE },
    }),
    prisma.invoice.groupBy({ by: ["docType"], where: { status: "AWAITING_APPROVAL", approvedAt: null }, _sum: { total: true }, _count: { _all: true } }),
    prisma.payment.findMany({
      where: { receivedAt: { gte: start, lt: end } },
      orderBy: { receivedAt: "desc" },
      select: { id: true, receivedAt: true, amount: true, tdsAmount: true, method: true, receiptNumber: true, receiptSentAt: true, invoice: { select: { id: true, number: true, client: { select: { name: true } } } } },
    }),
    prisma.invoicePart.findMany({ where: { status: "PENDING", plan: { status: "ACTIVE" } }, orderBy: { dueDate: "asc" }, take: 20, include: { plan: { select: { title: true, clientId: true, client: { select: { name: true } } } } } }),
    prisma.recurrenceRule.findMany({
      where: { stopped: false, nextRunAt: { not: null }, invoices: { some: {} } },
      orderBy: { nextRunAt: "asc" },
      take: 20,
      include: { invoices: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true, number: true, total: true, client: { select: { name: true } } } } },
    }),
  ]);
  const withBalance = open.map((r) => ({ ...r, balance: settleInvoice(r).balance })).filter((r) => r.balance > 0);
  const overdueRows = withBalance.filter((r) => r.status === "OVERDUE" || (r.dueDate && r.dueDate < now));
  const soonLimit = addDays(now, 7);
  const dueSoonRows = withBalance.filter((r) => !overdueRows.includes(r) && r.dueDate && r.dueDate <= soonLimit);
  const filtered = f.method ? monthPayments.filter((p) => p.method === f.method) : monthPayments;
  const byMethod = new Map<PaymentMethod, { method: PaymentMethod; amount: number; count: number }>();
  for (const p of monthPayments) {
    const m = byMethod.get(p.method) ?? { method: p.method, amount: 0, count: 0 };
    m.amount = round2(m.amount + p.amount.toNumber());
    m.count++;
    byMethod.set(p.method, m);
  }
  const outstandingByClient = groupByClient(withBalance).map((g) => ({ clientId: g.clientId, clientName: g.clientName, balance: g.balance, onHold: open.find((r) => r.clientId === g.clientId)?.client.workOnHold ?? false }));
  return {
    month,
    tiles: {
      outstanding: round2(withBalance.reduce((s, r) => s + r.balance, 0)),
      overdue: round2(overdueRows.reduce((s, r) => s + r.balance, 0)),
      receivedThisMonth: round2(filtered.reduce((s, p) => s + p.amount.toNumber(), 0)),
      // ADR 0013: proformas wait for approval too (count) but are not money owed, so they stay out of the ₹ total.
      awaitingApproval: round2(awaiting.filter((g) => g.docType !== "PROFORMA").reduce((s, g) => s + (g._sum.total?.toNumber() ?? 0), 0)),
      awaitingApprovalCount: awaiting.reduce((s, g) => s + g._count._all, 0),
    },
    dueSoon: groupByClient(dueSoonRows),
    overdue: groupByClient(overdueRows),
    outstandingByClient,
    upcoming: {
      parts: parts.map((p) => ({ planId: p.planId, seq: p.seq, clientId: p.plan.clientId, clientName: p.plan.client.name, title: p.plan.title, amount: p.amount.toNumber(), dueDate: p.dueDate.toISOString() })),
      recurrences: rules
        .filter((r) => r.invoices[0] && r.nextRunAt)
        .map((r) => ({ ruleId: r.id, invoiceId: r.invoices[0].id, clientName: r.invoices[0].client.name, number: r.invoices[0].number, total: r.invoices[0].total.toNumber(), nextRunAt: r.nextRunAt!.toISOString() })),
    },
    byMethod: Array.from(byMethod.values()).sort((a, b) => b.amount - a.amount),
    payments: filtered.map((p) => ({ id: p.id, receivedAt: p.receivedAt.toISOString(), amount: p.amount.toNumber(), tdsAmount: p.tdsAmount.toNumber(), method: p.method, invoiceId: p.invoice.id, invoiceNumber: p.invoice.number, clientName: p.invoice.client.name, receiptNumber: p.receiptNumber, receiptSentAt: iso(p.receiptSentAt) })),
  };
}

export type LedgerEntry = { date: string; kind: "INVOICE" | "PAYMENT" | "CREDIT_NOTE"; ref: string; invoiceId: string; description: string; debit: number; credit: number; balance: number };
export type ClientLedger = { clientId: string; clientName: string; entries: LedgerEntry[]; totals: { invoiced: number; received: number; tds: number; credited: number; outstanding: number } };

/** Chronological statement: approved invoices (debit) against payments, TDS and credit notes (credit). */
export async function clientLedger(clientId: string): Promise<ClientLedger | null> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  if (!client) return null;
  const invoices = await prisma.invoice.findMany({
    where: { clientId, docType: { in: [...BILLED_DOCS] }, approvedAt: { not: null }, status: { not: "CANCELLED" } },
    select: { id: true, number: true, total: true, approvedAt: true, description: true, payments: true, creditNotes: { where: { approvedAt: { not: null }, status: { not: "CANCELLED" } }, select: { number: true, total: true, approvedAt: true, description: true } } },
  });
  const raw: Omit<LedgerEntry, "balance">[] = [];
  for (const i of invoices) {
    raw.push({ date: i.approvedAt!.toISOString(), kind: "INVOICE", ref: i.number, invoiceId: i.id, description: i.description, debit: i.total.toNumber(), credit: 0 });
    for (const p of i.payments) {
      const tds = p.tdsAmount.toNumber();
      raw.push({ date: p.receivedAt.toISOString(), kind: "PAYMENT", ref: p.receiptNumber ?? p.id, invoiceId: i.id, description: `${p.method} against ${i.number}${tds ? ` (incl. TDS ${tds})` : ""}`, debit: 0, credit: round2(p.amount.toNumber() + tds) });
    }
    for (const c of i.creditNotes) raw.push({ date: c.approvedAt!.toISOString(), kind: "CREDIT_NOTE", ref: c.number, invoiceId: i.id, description: c.description || `Credit note against ${i.number}`, debit: 0, credit: c.total.toNumber() });
  }
  raw.sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  const entries = raw.map((e) => {
    running = round2(running + e.debit - e.credit);
    return { ...e, balance: running };
  });
  const totals = {
    invoiced: round2(invoices.reduce((s, i) => s + i.total.toNumber(), 0)),
    received: round2(invoices.reduce((s, i) => s + i.payments.reduce((x, p) => x + p.amount.toNumber(), 0), 0)),
    tds: round2(invoices.reduce((s, i) => s + i.payments.reduce((x, p) => x + p.tdsAmount.toNumber(), 0), 0)),
    credited: round2(invoices.reduce((s, i) => s + i.creditNotes.reduce((x, c) => x + c.total.toNumber(), 0), 0)),
    outstanding: round2(invoices.reduce((s, i) => s + settleInvoice({ total: i.total, payments: i.payments, creditNotes: i.creditNotes }).balance, 0)),
  };
  return { clientId, clientName: client.name, entries, totals };
}
