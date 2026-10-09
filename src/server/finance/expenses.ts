"use server";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { toCsv } from "@/server/finance/money";
import { requireFinanceActor } from "@/server/finance/guard";
import { listPaidOccurrences } from "@/server/finance/payables-queries";
import { monthKeySchema, parseInput } from "@/server/finance/schemas";
import { syncExpensesSheet, type SheetSyncResult } from "@/server/finance/sheets-sync";
import { tdsThresholdStatus, type TdsThresholdStatus } from "@/server/finance/tds";

/**
 * Expense exports (SPEC §11.2, ADR 0009): CSV and the push-only Sheet mirror list PAID bill payments (paid basis),
 * with TDS and GST columns. Bills and payments themselves are managed in payables.ts. ADMIN only.
 */
const PATH = "/admin/expenses";

/** Live check for the mark-paid sheet: where this payee stands against the TDS threshold with `amount` added. */
export async function vendorTdsStatus(vendor: string, amount: number, date: string | Date, excludeOccurrenceId?: string | null): Promise<ActionResult<TdsThresholdStatus>> {
  return wrap(async () => {
    await requireFinanceActor("read");
    const d = new Date(date);
    return tdsThresholdStatus(String(vendor ?? ""), Number(amount) || 0, Number.isNaN(d.getTime()) ? new Date() : d, excludeOccurrenceId ?? null);
  });
}

export const CSV_HEADERS = ["paidOn", "payee", "category", "type", "label", "amount", "tdsPercent", "tdsAmount", "netPaid", "method", "reference", "gstRate", "gstAmount", "vendorGstin", "gstClaimable", "bill", "note"];

/** CSV of the paid payments (optionally one month by paid date and/or one category); the client turns it into a download. */
export async function exportExpensesCsv(filter: { month?: string | null; category?: string | null } = {}): Promise<ActionResult<string>> {
  return wrap(async () => {
    await requireFinanceActor("read");
    const month = filter.month ? parseInput(monthKeySchema, filter.month) : null;
    const { rows, total } = await listPaidOccurrences({ month, category: filter.category ?? null });
    const table: unknown[][] = [CSV_HEADERS];
    for (const r of rows) {
      table.push([
        r.paidKey, r.payee, r.category, r.kind === "SALARY" ? "salary" : "regular", r.label ?? "", r.amount.toFixed(2), r.tdsPercent ?? "", r.tdsAmount.toFixed(2), (r.amount - r.tdsAmount).toFixed(2),
        r.method ?? "", r.reference ?? "", r.gstRate ?? "", r.gstAmount.toFixed(2), r.vendorGstin ?? "", r.itcClaimable ? "yes" : "no", r.hasBill ? r.billName ?? "yes" : "", r.note ?? "",
      ]);
    }
    const tds = rows.reduce((s, r) => s + r.tdsAmount, 0);
    const gst = rows.reduce((s, r) => s + (r.itcClaimable ? r.gstAmount : 0), 0);
    table.push([], ["TOTAL", total.toFixed(2)], ["TOTAL TDS", tds.toFixed(2)], ["TOTAL NET PAID", (total - tds).toFixed(2)], ["GST CLAIMABLE", gst.toFixed(2)]);
    return toCsv(table);
  });
}

export async function syncExpensesToSheet(): Promise<ActionResult<SheetSyncResult>> {
  return wrap(async () => {
    const actor = await requireFinanceActor("write");
    const res = await syncExpensesSheet(actor.id);
    safeRevalidate(PATH);
    return res;
  });
}
