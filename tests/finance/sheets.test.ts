import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

describe("finance sheet push-only sync", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
  });

  it("pushes invoices, payments, expenses and the summary; reports the spreadsheet and row count only", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const { syncFinanceSheet } = await import("@/server/finance/sheets-sync");
    const c = await createInvoice({ clientId: seed.client.id, items: [{ description: "Retainer", rate: 10000 }], sendNow: true });
    if (!c.ok) throw new Error(c.error);
    const p = await recordPayment({ invoiceId: c.data.id, amount: 1000, receivedAt: "2026-09-05", reference: "UTR1" });
    if (!p.ok) throw new Error(p.error);
    await testDb.expense.create({ data: { date: new Date(), amount: 250, category: "Travel", createdById: seed.admin.id } });
    const sync = await syncFinanceSheet(seed.admin.id);
    expect(sync).toEqual({ spreadsheetId: "mock_sheet_finance", created: expect.any(Boolean), rows: 3 });
    expect(sync).not.toHaveProperty("imported");
    // the app's data is untouched by a sync — the sheet is a mirror, never a source
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: c.data.id }, include: { payments: true } });
    expect(inv.payments).toHaveLength(1);
    expect(inv.status).toBe("PARTIALLY_PAID");
    expect(await testDb.auditLog.count({ where: { action: "finance.sheet_sync" } })).toBe(1);
  });

  it("the sheet → app pull path no longer exists", async () => {
    const core = await import("@/server/finance/sheets-sync");
    expect("pullPaymentsFromSheet" in core).toBe(false);
    expect("importPaymentRows" in core).toBe(false);
    expect("parsePaymentRows" in core).toBe(false);
    expect(typeof core.syncFinanceSheet).toBe("function");
    expect(typeof core.syncExpensesSheet).toBe("function");
    const actions = await import("@/server/finance/finance");
    expect("pullFinancePayments" in actions).toBe(false);
    expect(typeof actions.syncFinance).toBe("function");
  });

  it("sync is ADMIN-only", async () => {
    const { syncFinance } = await import("@/server/finance/finance");
    session.set({ id: seed.hr.id, role: "HR" });
    expect((await syncFinance()).ok).toBe(false);
    session.set({ id: seed.admin.id, role: "ADMIN" });
    const ok = await syncFinance();
    expect(ok.ok && ok.data).toMatchObject({ spreadsheetId: "mock_sheet_finance", rows: 0 });
  });
});
