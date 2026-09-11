import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { ensureSpreadsheet, writeTable } from "@/google/sheets";
import { financeSummary, listExpenses, listInvoices } from "@/server/finance/queries";
import { audit } from "@/lib/audit";

/**
 * Google Sheets sync for Expenses (§11.2) and the Finance sheet (§11.4). Push only: the sheets are a
 * read-only mirror of the app — every tab is rewritten from the database on each sync and nothing is ever
 * read back. Works in GOOGLE_MOCK mode.
 */
export type SheetSyncResult = { spreadsheetId: string; created: boolean; rows: number };

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

/** Rewrite the Invoices, Payments, Expenses and Summary tabs of the Finance sheet from the database. */
export async function syncFinanceSheet(actorId: string | null): Promise<SheetSyncResult> {
  const tz = (await getSettings()).timezone;
  const spreadsheetId = await ensureSpreadsheet("Finance", env.financeSheetId || undefined);
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
  return { spreadsheetId, created: !env.financeSheetId, rows: invoices.length + payments.length + expenses.rows.length };
}
