import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import * as menuModel from "@/components/shell/menu-model";
import { filterSections, menuSections, SOFT_HYPHEN, softHyphenate } from "@/components/shell/menu-model";
import type { MenuCounts } from "@/server/shell/menu";

/** ADR 0011 (v3 tiles): the Admin menu shows live counts as tile badges; only Admin can read them. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const DAY = 86_400_000;
const labels = (s: ReturnType<typeof menuSections>) => s.flatMap((x) => x.items.map((i) => i.label));

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

    // the Finance tile (approvals + overdue bills badge) left the menu: the nav's Dashboard tab and Requests cover it
    expect(menuSections(r.data).flatMap((s) => s.items).some((i) => i.label === "Finance")).toBe(false);
  });

  it("ADR 0016: HR / Tasks tiles carry what needs attention in their title and badge", async () => {
    const { menuCounts } = await import("@/server/shell/menu");
    const { hrSub, taskSub } = await import("@/components/shell/menu-model");
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
    const item = (label: string) => sections.flatMap((s) => s.items).find((i) => i.label === label)!;
    expect(item("HR")).toMatchObject({ href: "/admin/dashboards?view=HR", sub: "1 present · 1 on leave today" });
    expect(item("Tasks")).toMatchObject({ href: "/admin/dashboards?view=TASK", sub: "3 open · 1 late to start", badge: { n: 1, tone: "amber" } });
    expect(hrSub({ ...r.data, attendanceMarkedToday: false })).toBe("Attendance, inventory, leave");
    expect(taskSub({ ...r.data, tasksLate: 0 })).toBe("3 open");
    const hrefs = sections.flatMap((s) => s.items.map((i) => i.href));
    for (const gone of ["/admin/invoices", "/admin/payments", "/admin/expenses", "/admin/finance", "/admin/dashboards?view=FIN"]) expect(hrefs).not.toContain(gone);
    // the dashboards lost their action row (ADR 0016 addendum): Attendance and Inventory are tiles again
    for (const back of ["/attendance", "/admin/inventory"]) expect(hrefs).toContain(back);
  });

  it("v3 tiles: four colour groups in order — Money, Clients, Team, Other", () => {
    const sections = menuSections(null);
    expect(sections.map((s) => [s.title, s.tone])).toEqual([
      ["Money", "money"],
      ["Clients", "client"],
      ["Team", "team"],
      ["Other", "other"],
    ]);
    // Money: Drive folders · Clients: Shared links · Team: HR, Tasks, Attendance, Inventory · Other: Settings, Sign out
    expect(sections.map((s) => s.items.map((i) => [i.label, i.href]))).toEqual([
      [["Drive folders", "/admin/drive-folders"]],
      [["Shared links", "/admin/vault?tab=SHARED_DRIVE_LINK"]],
      [
        ["HR", "/admin/dashboards?view=HR"],
        ["Tasks", "/admin/dashboards?view=TASK"],
        ["Attendance", "/attendance"],
        ["Inventory", "/admin/inventory"],
      ],
      [
        ["Settings", "/admin/settings"],
        ["Sign out", "/api/auth/signout"],
      ],
    ]);
    // only Sign out is red; every other tile keeps its old subtitle for its title / aria-label and search
    const items = sections.flatMap((s) => s.items);
    expect(items.filter((i) => i.danger).map((i) => i.label)).toEqual(["Sign out"]);
    expect(items.filter((i) => !i.danger && !i.sub)).toEqual([]);
    expect(items.find((i) => i.label === "Drive folders")!.sub).toMatch(/^Monthly Drive folders/);
    // what the + speed dial adds (and its eyes list) left the menu; the pages and their ?add=1 stay
    for (const gone of ["/admin/client-kit", "/admin/clients", "/admin/people?role=EXECUTIVE", "/admin/people?role=TEAM_LEADER", "/admin/teams", "/admin/work-types"]) {
      expect(items.map((i) => i.href)).not.toContain(gone);
    }
    // the bottom nav's tabs (Dashboard › Finance, Requests, Notifications) left it too
    for (const gone of ["Finance", "Clients", "Requests", "Notifications"]) expect(items.map((i) => i.label)).not.toContain(gone);
    for (const gone of ["/admin/dashboards?view=FIN", "/admin/requests", "/notifications"]) expect(items.map((i) => i.href)).not.toContain(gone);
  });

  it("long tile labels get a soft hyphen in the middle so they wrap instead of clipping", () => {
    expect(softHyphenate("Notifications")).toBe(`Notifi${SOFT_HYPHEN}cations`);
    expect(softHyphenate("Attendance")).toBe(`Atten${SOFT_HYPHEN}dance`);
    expect(softHyphenate("Drive folders")).toBe("Drive folders");
    expect(softHyphenate("Inventory")).toBe("Inventory");
  });

  it("v3 tiles: only Tasks keeps a badge (amber, late to start); the red / soft ones left with their tiles", () => {
    const c: MenuCounts = {
      invoicesToApprove: 2, outstanding: 0, invoicesOverdue: 0, billsOverdue: 1, billsDueWeek: 0, gstToClaimMonth: 0, clients: 5, clientsWithKit: 3,
      credentials: 0, executives: 4, teams: ["Graphic"], workTypes: 3, requestsOpen: 6, unread: 7, company: "EOM", attendanceMarkedToday: false,
      presentToday: 0, onLeaveToday: 0, tasksOpen: 9, tasksLate: 4,
    };
    const badges = Object.fromEntries(menuSections(c).flatMap((s) => s.items).filter((i) => i.badge).map((i) => [i.label, i.badge]));
    expect(badges).toEqual({ Tasks: { n: 4, tone: "amber" } });
    const calm = { ...c, invoicesToApprove: 0, billsOverdue: 0, clientsWithKit: 5, tasksLate: 0, requestsOpen: 0, unread: 0 };
    expect(menuSections(calm).flatMap((s) => s.items).filter((i) => i.badge)).toEqual([]);
    expect(menuSections(null).flatMap((s) => s.items).filter((i) => i.badge)).toEqual([]);
  });

  it("v3 tiles: search filters tiles by label, old subtitle and section", () => {
    const all = menuSections(null);
    expect(filterSections(all, "  ")).toBe(all);
    expect(labels(filterSections(all, "kit"))).toEqual([]);
    // "GST pack" lives only in the Drive folders subtitle; "attendance" in HR's subtitle and the Attendance tile
    expect(labels(filterSections(all, "gst pack"))).toEqual(["Drive folders"]);
    expect(labels(filterSections(all, "ATTENDANCE"))).toEqual(["HR", "Attendance"]);
    expect(labels(filterSections(all, "hours available"))).toEqual(["Inventory"]);
    // the section name matches every tile in it
    const money = filterSections(all, "money");
    expect(money.map((s) => s.title)).toEqual(["Money"]);
    expect(labels(money)).toEqual(["Drive folders"]);
    expect(labels(filterSections(all, "finance"))).toEqual([]);
    expect(filterSections(all, "zzz")).toEqual([]);
  });

  it("has no quick-actions row any more (Approvals = Requests › Finance › Approvals; the + adds the rest)", () => {
    expect("QUICK_ACTIONS" in menuModel).toBe(false);
    const hrefs = menuSections(null).flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).not.toContain("/admin/requests?tab=FIN&fin=APPR");
  });

  it("ADR 0014: the kit status line (the Client kit tile left the menu; the summary stays for reuse)", async () => {
    const { kitSub } = await import("@/components/shell/menu-model");
    const sections = menuSections(null);
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
    expect(menuSections(r.data).find((s) => s.title === "Clients")!.items.map((i) => i.label)).toEqual(["Shared links"]);
  });

  it("ADR 0016: top-bar shortcuts (Requests and Notifications are bottom nav tabs, not tiles)", async () => {
    const other = menuSections(null).find((s) => s.title === "Other")!;
    expect(other.items.map((i) => i.label)).toEqual(["Settings", "Sign out"]);
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
    expect(hrefs).toEqual(["/admin/drive-folders", "/admin/vault?tab=SHARED_DRIVE_LINK", "/admin/dashboards?view=HR", "/admin/dashboards?view=TASK", "/attendance", "/admin/inventory", "/admin/settings", "/api/auth/signout"]);
  });
});
