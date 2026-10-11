import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

/** Expense exports on a paid basis + the legacy-expense data migration (ADR 0009). */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

async function paidBill(payee: string, category: string, amount: number, on: string) {
  const { createBill } = await import("@/server/finance/payables");
  const b = await createBill({ payee, category, amount, dueDate: on, alreadyPaid: true, paidMethod: "BANK" });
  if (!b.ok) throw new Error(b.error);
  return b.data.id;
}

describe("expenses · exports and migration", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
  });

  it("CSV filters by paid month and category; no finance access for CA / anonymous", async () => {
    const { exportExpensesCsv } = await import("@/server/finance/expenses");
    await paidBill("Uber", "Travel", 10, "2026-08-20");
    await paidBill("Figma", "Software", 20, "2026-09-02");
    const sep = await exportExpensesCsv({ month: "2026-09" });
    expect(sep.ok && sep.data).toContain("Figma");
    expect(sep.ok && sep.data).not.toContain("Uber");
    const sw = await exportExpensesCsv({ category: "software" });
    expect(sw.ok && sw.data).toContain("TOTAL,20.00");

    const ca = await testDb.user.create({ data: { email: "ca@external.test", name: "CA", role: "CA", activatedAt: new Date() } });
    session.set({ id: ca.id, role: "CA" });
    const denied = await exportExpensesCsv({ month: "2026-09" });
    expect(!denied.ok && denied.error).toMatch(/Finance access required/);
    session.clear();
    expect((await exportExpensesCsv()).ok).toBe(false);
  });

  it("sheet sync pushes one row per paid payment and stamps the bills", async () => {
    const { syncExpensesToSheet } = await import("@/server/finance/expenses");
    await paidBill("Uber", "Travel", 10, "2026-08-20");
    await paidBill("Figma", "Software", 20, "2026-09-02");
    const { createBill } = await import("@/server/finance/payables");
    await createBill({ payee: "Due Co", category: "Rent", amount: 5, dueDate: "2026-09-03" }); // DUE → not in the sheet
    const sync = await syncExpensesToSheet();
    expect(sync.ok && sync.data).toMatchObject({ spreadsheetId: "mock_sheet_expenses", rows: 2 });
    expect(await testDb.expense.count({ where: { sheetRowSyncedAt: { not: null } } })).toBe(2);
  });

  it("data migration: an existing expense becomes a one-time bill with one PAID occurrence (still in Paid and the TDS totals)", async () => {
    // A pre-ADR 0009 expense row (no occurrences), with TDS and a receipt.
    const e = await testDb.expense.create({
      data: { date: new Date("2026-06-10T04:30:00Z"), amount: 25000, category: "Rent", vendor: "Skyline Spaces", tdsApplied: true, tdsPercent: 10, tdsAmount: 2500, receiptImageData: Buffer.from([0x89, 0x50, 0x4e, 0x47]), receiptImageMime: "image/png", receiptImageDriveId: "file_old", createdById: seed.admin.id },
    });
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261010160000_payables_gst_month_folders_cancel/migration.sql"), "utf8");
    const block = sql.slice(sql.indexOf("-- DATA MIGRATION BEGIN"), sql.indexOf("-- DATA MIGRATION END"));
    expect(block).toContain('INSERT INTO "ExpenseOccurrence"');
    await testDb.$executeRawUnsafe(block);
    await testDb.$executeRawUnsafe(block); // idempotent
    const occ = await testDb.expenseOccurrence.findMany({ where: { expenseId: e.id } });
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({ seq: 1, status: "PAID", billMime: "image/png", billDriveId: "file_old" });
    expect(occ[0].paidAt?.toISOString()).toBe("2026-06-10T04:30:00.000Z");
    expect([occ[0].amount.toNumber(), occ[0].tdsAmount.toNumber(), occ[0].tdsPercent?.toNumber()]).toEqual([25000, 2500, 10]);

    const { listPaidOccurrences } = await import("@/server/finance/payables-queries");
    expect((await listPaidOccurrences({ month: "2026-06" })).rows.map((r) => [r.payee, r.amount])).toEqual([["Skyline Spaces", 25000]]);
    const { tdsSummary, vendorTdsSummary } = await import("@/server/finance/tds");
    expect((await tdsSummary(new Date("2026-09-01"))).onExpenses).toBe(2500);
    expect((await vendorTdsSummary(new Date("2026-09-01"))).vendors).toEqual([{ vendor: "Skyline Spaces", paid: 25000, tds: 2500, expenses: 1, crossed: true }]);
  });
});
