import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { ensureSpreadsheet, writeTable } from "@/google/sheets";
import { financeSummary, listInvoices } from "@/server/finance/queries";
import { listPaidOccurrences, type PaidRow } from "@/server/finance/payables-queries";
import { audit } from "@/lib/audit";

/**
 * Google Sheets sync for Expenses (§11.2) and the Finance sheet (§11.4). Push only: the sheets are a
 * read-only mirror of the app — every tab is rewritten from the database on each sync and nothing is ever
 * read back. Works in GOOGLE_MOCK mode.
 */
export type SheetSyncResult = { spreadsheetId: string; created: boolean; rows: number };

const PAYMENT_HEADERS = ["invoiceNumber", "amount", "tdsAmount", "receivedAt", "method", "reference", "receiptNumber", "client"];

/** ADR 0009: one row per PAID bill payment (paid basis) with TDS and GST columns. */
export const EXPENSE_SHEET_HEADERS = ["paidOn", "payee", "category", "type", "label", "amount", "tdsAmount", "netPaid", "method", "reference", "gstRate", "gstAmount", "vendorGstin", "gstClaimable", "billDriveId", "note", "billId", "paymentId"];

function expenseRow(r: PaidRow): (string | number)[] {
  return [
    r.paidKey ?? "", r.payee, r.category, r.kind === "SALARY" ? "salary" : "regular", r.label ?? "", r.amount, r.tdsAmount, r.amount - r.tdsAmount, r.method ?? "", r.reference ?? "",
    r.gstRate ?? "", r.gstAmount, r.vendorGstin ?? "", r.itcClaimable ? "yes" : "no", r.billDriveId ?? "", r.note ?? "", r.billId, r.id,
  ];
}

export async function syncExpensesSheet(actorId: string | null): Promise<SheetSyncResult> {
  const { rows } = await listPaidOccurrences();
  const spreadsheetId = await ensureSpreadsheet("Expenses", env.expensesSheetId || undefined);
  await writeTable(spreadsheetId, "Expenses", [EXPENSE_SHEET_HEADERS, ...rows.map(expenseRow)]);
  await prisma.expense.updateMany({ where: { id: { in: Array.from(new Set(rows.map((r) => r.billId))) } }, data: { sheetRowSyncedAt: new Date() } });
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
    listPaidOccurrences(),
    financeSummary(),
  ]);
  const d = (x: string | Date | null) => (x ? fmtDate(new Date(x), tz, "yyyy-MM-dd") : "");
  await writeTable(spreadsheetId, "Invoices", [
    ["number", "client", "status", "docType", "plan", "total", "received", "tds", "credited", "balance", "approvedAt", "dueDate", "id"],
    ...invoices.map((i) => [i.number, i.clientName, i.status, i.docType, i.plan, i.total, i.received, i.tds, i.credited, i.balance, d(i.approvedAt), d(i.dueDate), i.id]),
  ]);
  await writeTable(spreadsheetId, "Payments", [
    PAYMENT_HEADERS,
    ...payments.map((p) => [p.invoice.number, p.amount.toNumber(), p.tdsAmount.toNumber(), d(p.receivedAt), p.method, p.reference ?? "", p.receiptNumber ?? "", p.invoice.client.name]),
  ]);
  await writeTable(spreadsheetId, "Expenses", [EXPENSE_SHEET_HEADERS, ...expenses.rows.map(expenseRow)]);
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
