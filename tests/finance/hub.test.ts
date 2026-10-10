import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

/** ADR 0013: "Needs you" on the Payments & finance hub — bills overdue or due within 7 days. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const DAY = 86_400_000;

describe("payments & finance hub", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
  });

  it("lists bills overdue or due within a week, oldest first; paid and later ones stay out", async () => {
    const bill = await testDb.expense.create({ data: { date: new Date(), amount: 1000, category: "Rent", vendor: "Skyline Spaces", createdById: seed.admin.id } as never });
    await testDb.expenseOccurrence.createMany({
      data: [
        { expenseId: bill.id, seq: 1, amount: 1000, dueDate: new Date(Date.now() - 3 * DAY), status: "DUE", label: "Part 1 of 3" },
        { expenseId: bill.id, seq: 2, amount: 2000, dueDate: new Date(Date.now() + 2 * DAY), status: "DUE" },
        { expenseId: bill.id, seq: 3, amount: 3000, dueDate: new Date(Date.now() + 20 * DAY), status: "DUE" },
        { expenseId: bill.id, seq: 4, amount: 4000, dueDate: new Date(Date.now() - 9 * DAY), status: "PAID", paidAt: new Date() },
      ] as never,
    });
    const { billsNeedingPayment } = await import("@/server/finance/hub-queries");
    const rows = await billsNeedingPayment();
    expect(rows.map((r) => [r.amount, r.overdue, r.payee, r.label])).toEqual([[1000, true, "Skyline Spaces", "Part 1 of 3"], [2000, false, "Skyline Spaces", null]]);
  });

  it("the old Finance sheet URL redirects to the hub", async () => {
    const page = (await import("@/app/(app)/admin/finance/page")).default;
    await expect(page({ searchParams: Promise.resolve({ fy: "previous" }) })).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
