import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { menuSections } from "@/components/shell/MenuTray";

/** ADR 0011: the Admin menu shows live counts; only Admin can read them. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const DAY = 86_400_000;

describe("admin menu counts", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    (await import("@/lib/settings")).invalidateSettingsCache();
  });

  it("is admin only", async () => {
    const { menuCounts } = await import("@/server/shell/menu");
    session.set({ id: seed.tl.id, role: "TEAM_LEADER" });
    expect((await menuCounts()).ok).toBe(false);
  });

  it("counts approvals, overdue and upcoming bills, requests and unread notifications", async () => {
    const { menuCounts } = await import("@/server/shell/menu");
    await testDb.invoice.create({ data: { number: "DRAFT-x1", clientId: seed.client.id, status: "AWAITING_APPROVAL", subtotal: 100, gstAmount: 18, total: 118, gstPercent: 18 } as never });
    const bill = await testDb.expense.create({ data: { date: new Date(), amount: 1000, category: "Office", vendor: "Rent Co", createdById: seed.admin.id } as never });
    await testDb.expenseOccurrence.createMany({
      data: [
        { expenseId: bill.id, seq: 1, amount: 1000, dueDate: new Date(Date.now() - 3 * DAY), status: "DUE" },
        { expenseId: bill.id, seq: 2, amount: 1000, dueDate: new Date(Date.now() + 2 * DAY), status: "DUE" },
      ] as never,
    });
    await testDb.notification.create({ data: { userId: seed.admin.id, kind: "TASK_ASSIGNED", title: "x" } as never });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    const r = await menuCounts();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.invoicesToApprove).toBe(1);
    expect(r.data.billsOverdue).toBe(1);
    expect(r.data.billsDueWeek).toBe(1);
    expect(r.data.unread).toBe(1);
    expect(r.data.teams).toEqual(["Graphic"]);

    const money = menuSections(r.data).find((s) => s.title === "Money")!;
    expect(money.items.find((i) => i.label === "Invoices")!.badge).toEqual({ n: 1, tone: "red" });
    expect(money.items.find((i) => i.label === "Expenses")!.sub).toBe("1 overdue · 1 due this week");
  });

  it("lists every admin destination once", () => {
    const hrefs = menuSections(null).flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual(expect.arrayContaining(["/admin/invoices", "/admin/expenses", "/admin/drive-folders", "/admin/work-types", "/admin/teams", "/attendance", "/admin/settings"]));
  });
});
