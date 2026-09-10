import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

function form(fields: Record<string, string>, files: { receipt?: File; voice?: File } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (files.receipt) fd.set("receipt", files.receipt);
  if (files.voice) fd.set("voice", files.voice);
  return fd;
}

describe("expenses", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
  });

  it("admin creates an expense with receipt photo + voice note; attachments are stored and uploaded", async () => {
    const { createExpense } = await import("@/server/finance/expenses");
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], "bill.png", { type: "image/png" });
    const webm = new File([new Uint8Array([1, 2, 3, 4])], "note.webm", { type: "audio/webm" });
    const res = await createExpense(form({ date: "2026-09-05", amount: "1250.50", category: "Travel", vendor: "Uber", note: "Client visit", tags: "client, pune", voiceDurationSec: "12" }, { receipt: png, voice: webm }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const e = await testDb.expense.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(e.amount.toNumber()).toBe(1250.5);
    expect(e.tags).toEqual(["client", "pune"]);
    expect(e.receiptImageMime).toBe("image/png");
    expect(Buffer.from(e.receiptImageData!).length).toBe(7);
    expect(e.voiceNoteDurationSec).toBe(12);
    expect(e.receiptImageDriveId).toMatch(/^file_/);
    expect(e.voiceNoteDriveId).toMatch(/^file_/);
    expect(await testDb.auditLog.count({ where: { action: "expense.create" } })).toBe(1);
  });

  it("validates input", async () => {
    const { createExpense } = await import("@/server/finance/expenses");
    const res = await createExpense(form({ date: "2026-09-05", amount: "abc", category: "" }));
    expect(res.ok).toBe(false);
  });

  it("CA can read/export but cannot create, update or delete", async () => {
    const { createExpense, deleteExpense, exportExpensesCsv } = await import("@/server/finance/expenses");
    const { listExpenses } = await import("@/server/finance/queries");
    const created = await createExpense(form({ date: "2026-09-05", amount: "100", category: "Office" }));
    if (!created.ok) throw new Error(created.error);
    const ca = await testDb.user.create({ data: { email: "ca@external.test", name: "CA", role: "CA", activatedAt: new Date() } });
    session.set({ id: ca.id, role: "CA" });
    const list = await listExpenses({ month: "2026-09" });
    expect(list.rows).toHaveLength(1);
    expect(list.total).toBe(100);
    const csv = await exportExpensesCsv({ month: "2026-09" });
    expect(csv.ok && csv.data).toContain("Office");
    const denied = await createExpense(form({ date: "2026-09-05", amount: "1", category: "X" }));
    expect(denied.ok).toBe(false);
    const del = await deleteExpense(created.data.id);
    expect(del.ok).toBe(false);
    session.clear();
    const anon = await exportExpensesCsv();
    expect(anon.ok).toBe(false);
  });

  it("filters by month and category; update and delete work; sheet sync reports the spreadsheet", async () => {
    const { createExpense, updateExpense, deleteExpense, syncExpensesToSheet } = await import("@/server/finance/expenses");
    const { listExpenses, expenseCategories } = await import("@/server/finance/queries");
    const a = await createExpense(form({ date: "2026-08-20", amount: "10", category: "Travel" }));
    const b = await createExpense(form({ date: "2026-09-02", amount: "20", category: "Software" }));
    if (!a.ok || !b.ok) throw new Error("setup");
    expect((await listExpenses({ month: "2026-08" })).rows.map((r) => r.category)).toEqual(["Travel"]);
    expect((await listExpenses({ category: "software" })).total).toBe(20);
    expect(await expenseCategories()).toEqual(expect.arrayContaining(["Travel", "Software"]));
    const up = await updateExpense(b.data.id, form({ date: "2026-09-02", amount: "25", category: "Software", tags: "saas" }));
    expect(up.ok).toBe(true);
    expect((await listExpenses({ month: "2026-09" })).total).toBe(25);
    const sync = await syncExpensesToSheet();
    expect(sync.ok && sync.data).toMatchObject({ spreadsheetId: "mock_sheet_expenses", rows: 2 });
    expect(await testDb.expense.count({ where: { sheetRowSyncedAt: { not: null } } })).toBe(2);
    expect((await deleteExpense(a.data.id)).ok).toBe(true);
    expect((await listExpenses()).rows).toHaveLength(1);
  });
});
