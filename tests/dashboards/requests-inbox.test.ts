import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { groupByArea, inboxCounts, matchesWorkFilter, parseFinanceGroup, parseWorkFilter, requestArea, workFilterCounts } from "@/server/requests/areas";

/** ADR 0016: one requests inbox — Finance (hub "Needs you"), Work (task requests) and HR (leave). */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const DAY = 86_400_000;

describe("requests inbox", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
  });

  it("groups request types by area", () => {
    expect(["FINISH", "DOUBT", "REVIEW", "TIME_CHANGE", "FIX_SELF_TASK", "LEAVE", "APPROVED_CHANGE"].map(requestArea)).toEqual(["WORK", "WORK", "WORK", "WORK", "WORK", "HR", "HR"]);
    const g = groupByArea([{ type: "LEAVE", n: 1 }, { type: "REVIEW", n: 2 }, { type: "FINISH", n: 3 }]);
    expect(g.WORK.map((r) => r.n)).toEqual([2, 3]);
    expect(g.HR.map((r) => r.n)).toEqual([1]);
  });

  it("finance items, work and HR requests with counts; handled ones only on request", async () => {
    const task = await testDb.task.create({ data: { title: "Reel", clientId: seed.client.id, createdById: seed.admin.id } });
    const leave = await testDb.leave.create({ data: { userId: seed.exec.id, from: new Date("2026-11-02"), to: new Date("2026-11-03"), reason: "Trip" } });
    await testDb.request.createMany({
      data: [
        { type: "REVIEW", field: "mins", taskId: task.id, raisedById: seed.exec.id, targetRole: "ADMIN", note: "too short" },
        { type: "FINISH", taskId: task.id, raisedById: seed.tl.id, targetRole: "ADMIN" },
        { type: "TIME_CHANGE", taskId: task.id, raisedById: seed.tl.id, targetRole: "ADMIN", status: "RESOLVED" },
        { type: "LEAVE", leaveId: leave.id, raisedById: seed.exec.id, targetRole: "HR", note: "Trip" },
        { type: "APPROVED_CHANGE", leaveId: leave.id, raisedById: seed.exec.id, targetRole: "ADMIN" },
        { type: "DOUBT", taskId: task.id, raisedById: seed.tl.id, targetRole: "HR" }, // not Admin's
      ],
    });
    await testDb.invoice.create({ data: { number: "DRAFT-1", clientId: seed.client.id, status: "AWAITING_APPROVAL", subtotal: 100, gstAmount: 18, total: 118 } as never });
    await testDb.invoice.create({ data: { number: "EOM/26-27/0009", clientId: seed.client.id, status: "SENT", subtotal: 500, total: 500, approvedAt: new Date(), dueDate: new Date(Date.now() - 3 * DAY) } as never });
    const bill = await testDb.expense.create({ data: { date: new Date(), amount: 900, category: "Rent", vendor: "Skyline", createdById: seed.admin.id } });
    await testDb.expenseOccurrence.createMany({
      data: [
        { expenseId: bill.id, seq: 1, amount: 900, dueDate: new Date(Date.now() - 2 * DAY), status: "DUE" },
        { expenseId: bill.id, seq: 2, amount: 900, dueDate: new Date(Date.now() + 2 * DAY), status: "DUE" }, // due this week: listed, not late
        { expenseId: bill.id, seq: 3, amount: 900, dueDate: new Date(Date.now() + 20 * DAY), status: "DUE" }, // later: not listed
      ],
    });

    const { requestInbox } = await import("@/server/requests/inbox");
    const inbox = await requestInbox();
    expect(inbox.finance.map((f) => [f.kind, f.amount, f.late])).toEqual([["APPROVE", 118, false], ["OVERDUE", 500, true], ["BILL", 900, true], ["BILL", 900, false]]);
    expect(inbox.finance[1].sub).toBe("EOM/26-27/0009 · 3 days late");
    expect(inbox.finance[2].sub).toMatch(/^Bill 2 days late · mark paid$/);
    expect(inbox.finance[3].sub).toMatch(/^Bill due \d{1,2} [A-Z][a-z]{2} · mark paid$/);
    expect(inbox.finance[0].href).toMatch(/^\/admin\/invoices\/.+\?approve=1$/);
    expect(inbox.finance[2].href).toMatch(/^\/admin\/expenses\?tab=DUE&pay=/);
    expect(inbox.work.map((r) => r.type).sort()).toEqual(["FINISH", "REVIEW"]);
    expect(inbox.work.find((r) => r.type === "REVIEW")!.field).toBe("mins");
    expect(inbox.hr.map((r) => r.type).sort()).toEqual(["APPROVED_CHANGE", "LEAVE"]);
    expect(inboxCounts(inbox)).toEqual({ FIN: 4, WORK: 2, HR: 2, APPR: 1, PAY: 1, EXP: 2 });

    const all = await requestInbox({ includeResolved: true });
    expect(all.work.map((r) => r.type).sort()).toEqual(["FINISH", "REVIEW", "TIME_CHANGE"]);
    expect(inboxCounts(all)).toMatchObject({ FIN: 4, WORK: 2, HR: 2 });
    expect([parseFinanceGroup("PAY"), parseFinanceGroup("x"), parseFinanceGroup(undefined)]).toEqual(["PAY", null, null]);
  });

  it("Work tab: narrows by the request's task team and client (both combine), counts open requests per pill", () => {
    const row = (status: string, task: { clientId: string; teamIds: string[] } | null) => ({ status, task });
    const social = row("OPEN", { clientId: "zenith", teamIds: ["social"] });
    const both = row("OPEN", { clientId: "acme", teamIds: ["social", "seo"] });
    const seoZenith = row("OPEN", { clientId: "zenith", teamIds: ["seo"] });
    const handled = row("RESOLVED", { clientId: "zenith", teamIds: ["social"] });
    const leaveLike = row("OPEN", null);
    const rows = [social, both, seoZenith, handled, leaveLike];
    const pass = (team: string | null, client: string | null) => rows.filter((r) => matchesWorkFilter(r, { team, client }));

    expect(pass(null, null)).toEqual(rows); // All · All
    expect(pass("social", null)).toEqual([social, both, handled]);
    expect(pass("seo", null)).toEqual([both, seoZenith]);
    expect(pass(null, "zenith")).toEqual([social, seoZenith, handled]);
    expect(pass("seo", "zenith")).toEqual([seoZenith]);
    expect(pass("graphic", null)).toEqual([]); // a task without that team, or without a task, never passes a pick

    // counts: OPEN only, each row on its own (a task in two teams counts for both)
    expect(workFilterCounts(rows)).toEqual({ teams: { social: 2, seo: 2 }, clients: { zenith: 2, acme: 1 } });
    expect(workFilterCounts([])).toEqual({ teams: {}, clients: {} });
    expect(workFilterCounts([row("OPEN", { clientId: "z", teamIds: ["t", "t"] })]).teams).toEqual({ t: 1 });

    expect(parseWorkFilter({ team: "t1", client: "c_9" })).toEqual({ team: "t1", client: "c_9" });
    expect(parseWorkFilter({ team: "bad id!", client: ["c1"] })).toEqual({ team: null, client: null });
    expect(parseWorkFilter({})).toEqual({ team: null, client: null });
  });

  it("Work requests carry their task's client and teams; the rows list active teams and clients", async () => {
    const task = await testDb.task.create({ data: { title: "Reel", clientId: seed.client.id, createdById: seed.admin.id, teams: { create: [{ teamId: seed.team.id }] } } });
    await testDb.request.create({ data: { type: "FINISH", taskId: task.id, raisedById: seed.tl.id, targetRole: "ADMIN" } });
    await testDb.team.create({ data: { name: "Old", active: false } });
    const { requestInbox } = await import("@/server/requests/inbox");
    const { workFilterOptions } = await import("@/server/requests/queries");
    const inbox = await requestInbox();
    expect(inbox.work[0].task).toMatchObject({ clientId: seed.client.id, teamIds: [seed.team.id], client: "Repo" });
    expect(inbox.work.filter((r) => matchesWorkFilter(r, { team: seed.team.id, client: seed.client.id }))).toHaveLength(1);
    expect(workFilterCounts(inbox.work)).toEqual({ teams: { [seed.team.id]: 1 }, clients: { [seed.client.id]: 1 } });
    const names = await workFilterOptions();
    expect(names.teams.map((t) => t.name)).toEqual(["Graphic"]);
    expect(names.clients.map((c) => c.name)).toEqual(["Repo"]);
  });

  it("only Admin opens /admin/requests; the old /requests URL forwards", async () => {
    const page = (await import("@/app/(app)/admin/requests/page")).default;
    for (const u of [seed.tl, seed.exec, seed.hr]) {
      session.set({ id: u.id, role: u.role });
      await expect(page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_REDIRECT/);
    }
    session.set({ id: seed.admin.id, role: "ADMIN" });
    await expect(page({ searchParams: Promise.resolve({ tab: "WORK" }) })).resolves.toBeTruthy();
    await expect(page({ searchParams: Promise.resolve({ tab: "FIN", fin: "APPR" }) })).resolves.toBeTruthy();
    await expect(page({ searchParams: Promise.resolve({ tab: "WORK", team: seed.team.id, client: seed.client.id }) })).resolves.toBeTruthy();
    const old = (await import("@/app/(app)/requests/page")).default;
    await expect(old({ searchParams: Promise.resolve({ tab: "HR" }) })).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
