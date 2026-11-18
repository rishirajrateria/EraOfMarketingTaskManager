"use server";
import { can, requireUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { toCsv } from "@/server/finance/money";
import { financeSummary } from "@/server/finance/queries";
import { syncFinanceSheet, type SheetSyncResult } from "@/server/finance/sheets-sync";

/** Finance sheet actions (SPEC §11.4): CSV export and the push-only Google Sheet mirror. ADMIN only. */
async function requireWrite() {
  const u = await requireUser();
  if (!can.financeWrite(u)) throw new ForbiddenError("Only Admin can sync the finance sheet");
  return u;
}

export async function exportFinanceCsv(): Promise<ActionResult<string>> {
  return wrap(async () => {
    const u = await requireUser();
    if (!can.financeRead(u)) throw new ForbiddenError("Finance access required");
    const s = await financeSummary();
    const rows: unknown[][] = [["month", "invoiced", "received", "expenses", "net"]];
    for (const m of s.months) rows.push([m.month, m.invoiced.toFixed(2), m.received.toFixed(2), m.expenses.toFixed(2), m.net.toFixed(2)]);
    rows.push([], ["client", "invoiced", "received", "outstanding"]);
    for (const c of s.clients) rows.push([c.clientName, c.invoiced.toFixed(2), c.received.toFixed(2), c.outstanding.toFixed(2)]);
    rows.push([], ["TOTAL invoiced", s.totals.invoiced.toFixed(2)], ["TOTAL received", s.totals.received.toFixed(2)], ["TOTAL outstanding", s.totals.outstanding.toFixed(2)], ["TOTAL expenses", s.totals.expenses.toFixed(2)], ["NET", s.totals.net.toFixed(2)]);
    return toCsv(rows);
  });
}

/** Push the app's invoices, payments, expenses and summary to the Google Sheet (a read-only mirror). */
export async function syncFinance(): Promise<ActionResult<SheetSyncResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const res = await syncFinanceSheet(actor.id);
    safeRevalidate("/admin/finance", "/admin/invoices");
    return res;
  });
}
