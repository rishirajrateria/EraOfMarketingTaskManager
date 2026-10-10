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

  it("ADR 0013: one 'Payments & finance' row says what needs attention (no separate Finance sheet)", async () => {
    const { menuCounts } = await import("@/server/shell/menu");
    const { paymentsSub } = await import("@/components/shell/MenuTray");
    const inv = (n: string, status: string, total: number, due: number) =>
      testDb.invoice.create({ data: { number: n, clientId: seed.client.id, docType: "TAX_INVOICE", status, subtotal: total, gstAmount: 0, total, gstPercent: 0, approvedAt: new Date(), dueDate: new Date(Date.now() + due * DAY) } as never });
    await inv("EOM/26-27/0001", "SENT", 400000, -3); // overdue
    await inv("EOM/26-27/0002", "SENT", 22400, 10);
    await testDb.invoice.create({ data: { number: "DRAFT-a", clientId: seed.client.id, status: "AWAITING_APPROVAL", subtotal: 1, gstAmount: 0, total: 1, gstPercent: 0 } as never });
    await testDb.invoice.create({ data: { number: "DRAFT-b", clientId: seed.client.id, docType: "PROFORMA", status: "AWAITING_APPROVAL", subtotal: 1, gstAmount: 0, total: 1, gstPercent: 0 } as never });
    await testDb.invoice.create({ data: { number: "EOM-PRO/26-27/0001", clientId: seed.client.id, docType: "PROFORMA", status: "SENT", subtotal: 99999, gstAmount: 0, total: 99999, gstPercent: 0, approvedAt: new Date() } as never });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    const r = await menuCounts();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ invoicesToApprove: 2, invoicesOverdue: 1, outstanding: 422400 });
    const money = menuSections(r.data).find((s) => s.title === "Money")!;
    const row = money.items.find((i) => i.href === "/admin/payments")!;
    expect(row.label).toBe("Payments & finance");
    expect(row.sub).toBe("2 to approve · 1 overdue · ₹4,22,400 due");
    expect(paymentsSub({ ...r.data, invoicesOverdue: 0 })).toBe("2 to approve · ₹4,22,400 outstanding");
    expect(row.badge).toEqual({ n: 1, tone: "amber" });
    expect(money.items.map((i) => i.label)).toEqual(["Invoices", "Payments & finance", "Expenses", "Monthly Drive folders"]);
    expect(paymentsSub({ ...r.data, invoicesToApprove: 0, invoicesOverdue: 0, outstanding: 0, gstToClaimMonth: 0 })).toBe("Nothing pending · totals, TDS, GST");
    expect(menuSections(null).flatMap((s) => s.items.map((i) => i.href))).not.toContain("/admin/finance");
  });

  it("ADR 0014: Clients has one Client kit row; Attendance + Inventory have their own section and colour", async () => {
    const { kitSub } = await import("@/components/shell/MenuTray");
    const sections = menuSections(null);
    const byTitle = (t: string) => sections.find((s) => s.title === t)!;
    expect(sections.map((s) => s.title)).toEqual(["Money", "Clients", "Team", "Time & attendance", "Account"]);
    expect(byTitle("Clients").items.map((i) => i.label)).toEqual(["Clients", "Client kit", "Shared drive links"]);
    expect(byTitle("Team").items.map((i) => i.label)).toEqual(["Executives", "Team leaders", "Teams", "Work types"]);
    expect(byTitle("Time & attendance").items.map((i) => i.href)).toEqual(["/attendance", "/admin/inventory"]);
    expect(byTitle("Time & attendance").tone).not.toBe(byTitle("Team").tone);
    const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain("/admin/vault?tab=CREDENTIAL");
    expect(hrefs).not.toContain("/admin/vault?tab=ASSET_DRIVE_LINK");

    await testDb.client.update({ where: { id: seed.client.id }, data: { kitFolderId: "f", kitSheetId: "s" } });
    await testDb.client.create({ data: { name: "Second" } });
    await testDb.clientVaultItem.create({ data: { clientId: seed.client.id, kind: "CREDENTIAL", label: "Instagram" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    const { menuCounts } = await import("@/server/shell/menu");
    const r = await menuCounts();
    expect(r.ok && r.data.clientsWithKit).toBe(1);
    if (!r.ok) return;
    expect(kitSub(r.data)).toBe("1 of 2 clients have a kit · 1 saved login");
    expect(menuSections(r.data).find((s) => s.title === "Clients")!.items[1].sub).toBe("1 of 2 clients have a kit · 1 saved login");
  });

  it("lists every admin destination once", () => {
    const hrefs = menuSections(null).flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual(expect.arrayContaining(["/admin/invoices", "/admin/expenses", "/admin/drive-folders", "/admin/work-types", "/admin/teams", "/attendance", "/admin/settings"]));
  });
});
