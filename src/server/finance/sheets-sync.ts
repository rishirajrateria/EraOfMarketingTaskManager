import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { ensureSpreadsheet, readTable, writeTable } from "@/google/sheets";
import { financeSummary, listExpenses, listInvoices } from "@/server/finance/queries";
import { recordPaymentCore } from "@/server/finance/payment-core";
import { audit } from "@/lib/audit";

/** Google Sheets sync for Expenses (§11.2) and the two-way Finance sheet (§11.4). Works in GOOGLE_MOCK mode. */
export type SheetSyncResult = { spreadsheetId: string; created: boolean; rows: number; imported?: number; skipped?: number };

const PAYMENT_HEADERS = ["invoiceNumber", "amount", "receivedAt", "method", "reference", "receiptNumber", "client"];

export async function syncExpensesSheet(actorId: string | null): Promise<SheetSyncResult> {
  const tz = (await getSettings()).timezone;
  const { rows } = await listExpenses();
  const spreadsheetId = await ensureSpreadsheet("Expenses", env.expensesSheetId || undefined);
  const table: (string | number)[][] = [
    ["date", "amount", "category", "vendor", "note", "tags", "receiptDriveId", "createdBy", "id"],
    ...rows.map((e) => [fmtDate(new Date(e.date), tz, "yyyy-MM-dd"), e.amount, e.category, e.vendor ?? "", e.note ?? "", e.tags.join(", "), e.receiptDriveId ?? "", e.createdBy, e.id]),
  ];
  await writeTable(spreadsheetId, "Expenses", table);
  await prisma.expense.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { sheetRowSyncedAt: new Date() } });
  await audit(actorId, "expenses.sheet_sync", "Spreadsheet", spreadsheetId, undefined, { rows: rows.length });
  return { spreadsheetId, created: !env.expensesSheetId, rows: rows.length };
}

/** Pull first (so CA-entered payment rows are never clobbered), then push all four tabs. */
export async function syncFinanceSheet(actorId: string | null): Promise<SheetSyncResult> {
  const pulled = await pullPaymentsFromSheet(actorId);
  const tz = (await getSettings()).timezone;
  const spreadsheetId = pulled.spreadsheetId;
  const [invoices, payments, expenses, summary] = await Promise.all([
    listInvoices(),
    prisma.payment.findMany({ include: { invoice: { select: { number: true, client: { select: { name: true } } } } }, orderBy: { receivedAt: "asc" } }),
    listExpenses(),
    financeSummary(),
  ]);
  const d = (x: string | Date | null) => (x ? fmtDate(new Date(x), tz, "yyyy-MM-dd") : "");
  await writeTable(spreadsheetId, "Invoices", [
    ["number", "client", "status", "kind", "paymentMode", "total", "received", "balance", "sentAt", "dueDate", "id"],
    ...invoices.map((i) => [i.number, i.clientName, i.status, i.kind, i.paymentMode, i.total, i.received, i.balance, d(i.sentAt), d(i.dueDate), i.id]),
  ]);
  await writeTable(spreadsheetId, "Payments", [
    PAYMENT_HEADERS,
    ...payments.map((p) => [p.invoice.number, p.amount.toNumber(), d(p.receivedAt), p.method, p.reference ?? "", p.receiptNumber ?? "", p.invoice.client.name]),
  ]);
  await writeTable(spreadsheetId, "Expenses", [
    ["date", "amount", "category", "vendor", "note", "tags"],
    ...expenses.rows.map((e) => [d(e.date), e.amount, e.category, e.vendor ?? "", e.note ?? "", e.tags.join(", ")]),
  ]);
  await writeTable(spreadsheetId, "Summary", [
    ["month", "invoiced", "received", "expenses", "net"],
    ...summary.months.map((m) => [m.month, m.invoiced, m.received, m.expenses, m.net]),
    [],
    ["client", "invoiced", "received", "outstanding"],
    ...summary.clients.map((c) => [c.clientName, c.invoiced, c.received, c.outstanding]),
  ]);
  await audit(actorId, "finance.sheet_sync", "Spreadsheet", spreadsheetId, undefined, { invoices: invoices.length, payments: payments.length });
  return { spreadsheetId, created: !env.financeSheetId, rows: invoices.length + payments.length + expenses.rows.length, imported: pulled.imported, skipped: pulled.skipped };
}

/** Read the "Payments" tab and record rows that are not yet in the DB (the Sheets → app half of the sync). */
export async function pullPaymentsFromSheet(actorId: string | null): Promise<SheetSyncResult> {
  const spreadsheetId = await ensureSpreadsheet("Finance", env.financeSheetId || undefined);
  const rows = await readTable(spreadsheetId, "Payments");
  const res = await importPaymentRows(rows, actorId);
  return { spreadsheetId, created: !env.financeSheetId, rows: rows.length, ...res };
}

type ParsedRow = { invoiceNumber: string; amount: number; receivedAt: Date; method: string; reference: string | null; receiptNumber: string | null };

export function parsePaymentRows(rows: string[][]): ParsedRow[] {
  if (rows.length === 0) return [];
  const first = rows[0].map((c) => String(c ?? "").trim());
  const hasHeader = first.some((c) => /^invoice ?number$/i.test(c));
  const idx = (name: string, fallback: number) => {
    const i = hasHeader ? first.findIndex((c) => c.toLowerCase() === name.toLowerCase()) : -1;
    return i >= 0 ? i : fallback;
  };
  const cols = { invoiceNumber: idx("invoiceNumber", 0), amount: idx("amount", 1), receivedAt: idx("receivedAt", 2), method: idx("method", 3), reference: idx("reference", 4), receiptNumber: idx("receiptNumber", 5) };
  const body = hasHeader ? rows.slice(1) : rows;
  const out: ParsedRow[] = [];
  for (const r of body) {
    const get = (i: number) => String(r[i] ?? "").trim();
    const invoiceNumber = get(cols.invoiceNumber);
    const amount = Number(get(cols.amount).replace(/[^0-9.\-]/g, ""));
    const receivedAt = new Date(get(cols.receivedAt) || NaN);
    if (!invoiceNumber || !Number.isFinite(amount) || amount <= 0) continue;
    out.push({
      invoiceNumber,
      amount,
      receivedAt: Number.isNaN(receivedAt.getTime()) ? new Date() : receivedAt,
      method: get(cols.method) || "BANK_TRANSFER",
      reference: get(cols.reference) || null,
      receiptNumber: get(cols.receiptNumber) || null,
    });
  }
  return out;
}

/** Match by receiptNumber, then reference, then invoiceNumber+amount+calendar day; record the rest. */
export async function importPaymentRows(rows: string[][], actorId: string | null): Promise<{ imported: number; skipped: number }> {
  const parsed = parsePaymentRows(rows);
  let imported = 0;
  let skipped = 0;
  for (const p of parsed) {
    const inv = await prisma.invoice.findUnique({ where: { number: p.invoiceNumber }, include: { payments: true } });
    if (!inv) {
      skipped++;
      continue;
    }
    const dayKey = p.receivedAt.toISOString().slice(0, 10);
    const exists = inv.payments.some(
      (x) =>
        (p.receiptNumber && x.receiptNumber === p.receiptNumber) ||
        (p.reference && x.reference === p.reference) ||
        (Math.abs(x.amount.toNumber() - p.amount) < 0.005 && x.receivedAt.toISOString().slice(0, 10) === dayKey),
    );
    if (exists || inv.status === "DRAFT" || inv.status === "SCHEDULED") {
      skipped++;
      continue;
    }
    await recordPaymentCore({ invoiceId: inv.id, amount: p.amount, receivedAt: p.receivedAt, method: p.method, reference: p.reference }, actorId);
    imported++;
  }
  return { imported, skipped };
}
