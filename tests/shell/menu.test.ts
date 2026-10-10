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

    // ADR 0016: the Finance dashboard row's red badge = approvals + overdue bills
    const dash = menuSections(r.data).find((s) => s.title === "Dashboards")!;
    expect(dash.items.find((i) => i.label === "Finance dashboard")!.badge).toEqual({ n: 2, tone: "red" });
  });

  it("ADR 0016: a Dashboards section (Finance · HR · Task · Drive folders) says what needs attention", async () => {
    const { menuCounts } = await import("@/server/shell/menu");
    const { financeSub, hrSub, taskSub } = await import("@/components/shell/MenuTray");
    const inv = (n: string, status: string, total: number, due: number) =>
      testDb.invoice.create({ data: { number: n, clientId: seed.client.id, docType: "TAX_INVOICE", status, subtotal: total, gstAmount: 0, total, gstPercent: 0, approvedAt: new Date(), dueDate: new Date(Date.now() + due * DAY) } as never });
    await inv("EOM/26-27/0001", "SENT", 400000, -3);
    await inv("EOM/26-27/0002", "SENT", 22400, 10);
    await testDb.invoice.create({ data: { number: "DRAFT-a", clientId: seed.client.id, status: "AWAITING_APPROVAL", subtotal: 1, gstAmount: 0, total: 1, gstPercent: 0 } as never });
    await testDb.invoice.create({ data: { number: "EOM-PRO/26-27/0001", clientId: seed.client.id, docType: "PROFORMA", status: "SENT", subtotal: 99999, gstAmount: 0, total: 99999, gstPercent: 0, approvedAt: new Date() } as never });
    const { dateKey } = await import("@/lib/time");
    const todayDb = new Date(`${dateKey(new Date(), "Asia/Kolkata")}T00:00:00Z`);
    await testDb.attendance.create({ data: { userId: seed.tl.id, date: todayDb, status: "PRESENT" } });
    await testDb.leave.create({ data: { userId: seed.exec.id, from: todayDb, to: todayDb, status: "HR_APPROVED" } });
    const task = (data: Record<string, unknown>) => testDb.task.create({ data: { title: "t", clientId: seed.client.id, createdById: seed.admin.id, status: "ASSIGNED", ...data } as never });
    await task({ scheduledStart: new Date(Date.now() - 3_600_000) }); // late to start
    await task({ scheduledStart: new Date(Date.now() - 3_600_000), doubtRaised: true }); // purple, not late
    await task({ scheduledStart: new Date(Date.now() + 3_600_000) });
    await task({ status: "COMPLETED" });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    const r = await menuCounts();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ invoicesToApprove: 1, outstanding: 422400, attendanceMarkedToday: true, presentToday: 1, onLeaveToday: 1, tasksOpen: 3, tasksLate: 1 });
    const sections = menuSections(r.data);
    expect(sections.map((s) => s.title)).toEqual(["Dashboards", "Clients", "Team", "Account"]);
    const dash = sections[0];
    expect(dash.items.map((i) => [i.label, i.href])).toEqual([
      ["Finance dashboard", "/admin/dashboards?view=FIN"],
      ["HR dashboard", "/admin/dashboards?view=HR"],
      ["Task dashboard", "/admin/dashboards?view=TASK"],
      ["Monthly Drive folders", "/admin/drive-folders"],
    ]);
    expect(dash.items[0].sub).toBe("1 to approve · ₹4.2L outstanding");
    expect(financeSub({ ...r.data, invoicesToApprove: 0 })).toBe("₹4,22,400 outstanding");
    expect(dash.items[1].sub).toBe("1 present · 1 on leave today");
    expect(dash.items[2]).toMatchObject({ sub: "3 open · 1 late to start", badge: { n: 1, tone: "amber" } });
    expect(financeSub({ ...r.data, invoicesToApprove: 0, outstanding: 0 })).toBe("Income, expense, invoices, bills");
    expect(hrSub({ ...r.data, attendanceMarkedToday: false })).toBe("Attendance, inventory, leave");
    expect(taskSub({ ...r.data, tasksLate: 0 })).toBe("3 open");
    const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
    for (const gone of ["/admin/invoices", "/admin/payments", "/admin/expenses", "/attendance", "/admin/inventory", "/admin/finance"]) expect(hrefs).not.toContain(gone);
  });

  it("ADR 0014: Clients has one Client kit row; Attendance + Inventory have their own section and colour", async () => {
    const { kitSub } = await import("@/components/shell/MenuTray");
    const sections = menuSections(null);
    const byTitle = (t: string) => sections.find((s) => s.title === t)!;
    expect(sections.map((s) => s.title)).toEqual(["Dashboards", "Clients", "Team", "Account"]);
    expect(byTitle("Clients").items.map((i) => i.label)).toEqual(["Clients", "Client kit", "Shared drive links"]);
    expect(byTitle("Team").items.map((i) => i.label)).toEqual(["Executives", "Team leaders", "Teams", "Work types"]);
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

  it("ADR 0016: Requests opens the one inbox; top-bar shortcuts", async () => {
    const account = menuSections(null).find((s) => s.title === "Account")!;
    expect(account.items.find((i) => i.label === "Requests")!.href).toBe("/admin/requests");
    const { shortcutLinks } = await import("@/components/shell/TopIcons");
    expect(shortcutLinks("rishi@eom.in")).toEqual({
      gmail: "https://mail.google.com/mail/?authuser=rishi%40eom.in",
      drive: "https://drive.google.com/drive/?authuser=rishi%40eom.in",
      whatsapp: "https://wa.me/",
    });
    expect(shortcutLinks(null).gmail).toBe("https://mail.google.com/mail/");
  });

  it("lists every admin destination once", () => {
    const hrefs = menuSections(null).flatMap((s) => s.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual(expect.arrayContaining(["/admin/dashboards?view=FIN", "/admin/drive-folders", "/admin/work-types", "/admin/teams", "/admin/settings", "/admin/requests"]));
  });
});
