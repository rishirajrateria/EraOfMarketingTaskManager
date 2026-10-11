import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { dateKey } from "@/lib/time";
import { toDbDate } from "@/server/inventory/compute";

/** ADR 0016: HR dashboard (today's attendance + inventory) and Task dashboard (row colours, hours, on time). */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const HOUR = 3_600_000;
const tz = "Asia/Kolkata";

describe("HR dashboard", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
  });

  it("today's status, booked of capacity from the inventory, days off, team filter", async () => {
    const now = new Date();
    const today = toDbDate(dateKey(now, tz));
    const other = await testDb.team.create({ data: { name: "SEO" } });
    const seoExec = await testDb.user.create({ data: { email: "s@t.local", name: "Sana", role: "EXECUTIVE", teamId: other.id } });
    await testDb.attendance.create({ data: { userId: seed.tl.id, date: today, status: "PRESENT" } });
    await testDb.leave.create({ data: { userId: seed.exec.id, from: today, to: today, status: "ADMIN_APPROVED" } });
    await testDb.task.create({
      data: { title: "Brief", clientId: seed.client.id, createdById: seed.admin.id, allocatedMinutes: 120, status: "ASSIGNED", scheduledStart: new Date(now.getTime() + HOUR), assignees: { create: [{ userId: seed.tl.id }] } },
    });
    const { hrDashboard, todayStatus, bookedPct } = await import("@/server/dashboards/hr");
    const { inventoryFor } = await import("@/server/inventory/queries");
    const h = await hrDashboard({ team: null, period: "MONTH" }, now);
    expect(h).toMatchObject({ staff: 3, presentToday: 1, onLeaveToday: 1 });
    const by = (name: string) => h.people.find((p) => p.name === name)!;
    expect(by("Rishi")).toMatchObject({ today: "PRESENT", bookedMin: 120, role: "TEAM_LEADER", teamName: "Graphic" });
    expect(by("Arush")).toMatchObject({ today: "LEAVE", daysOff: 1 });
    expect(by("Sana")).toMatchObject({ today: "NONE", bookedMin: 0, teamName: "SEO" });
    // same capacity as the Inventory page for the period
    const inv = await inventoryFor({ from: h.range.start, to: new Date(h.range.end.getTime() - HOUR) });
    expect(by("Rishi").capacityMin).toBe(inv.users.find((u) => u.userId === seed.tl.id)!.capacityMinutes);
    expect(h.capacityMin).toBe(h.people.reduce((s, p) => s + p.capacityMin, 0));
    expect(h.freeMin).toBe(Math.max(0, h.capacityMin - h.bookedMin));
    // team filter
    const g = await hrDashboard({ team: seed.team.id, period: "MONTH" }, now);
    expect(g.people.map((p) => p.name)).toEqual(["Rishi", "Arush"]);
    expect(seoExec.id).toBeTruthy();
    // pure helpers
    expect([todayStatus("HALF_DAY", true), todayStatus(null, true), todayStatus(undefined, false)]).toEqual(["HALF_DAY", "LEAVE", "NONE"]);
    expect([bookedPct(30, 60), bookedPct(90, 60), bookedPct(10, 0), bookedPct(0, 0)]).toEqual([50, 100, 100, 0]);
  });
});

describe("Task dashboard", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
  });

  it("counts open tasks by row colour, hours by team / client, completed and on time in the period", async () => {
    const now = new Date();
    const at = (h: number) => new Date(now.getTime() + h * HOUR);
    const seo = await testDb.team.create({ data: { name: "SEO" } });
    const zenith = await testDb.client.create({ data: { name: "Zenith" } });
    const mk = (title: string, data: Record<string, unknown>, teamId = seed.team.id) =>
      testDb.task.create({ data: { title, clientId: seed.client.id, createdById: seed.admin.id, allocatedMinutes: 60, status: "ASSIGNED", teams: { create: [{ teamId }] }, ...data } as never });
    await mk("started", { status: "STARTED", allocatedMinutes: 120, scheduledStart: at(-2), actualStart: at(-2) });
    await mk("late", { scheduledStart: at(-1) });
    await mk("paused", { status: "PAUSED", scheduledStart: at(-3) });
    await mk("doubt", { doubtRaised: true, scheduledStart: at(-1) });
    await mk("later", { scheduledStart: at(5), clientId: zenith.id, allocatedMinutes: 90 }, seo.id);
    await mk("call", { type: "MEETING", scheduledStart: at(-1), allocatedMinutes: 30 });
    await mk("done on time", { status: "COMPLETED", scheduledEnd: at(-2), finishRequestedAt: at(-3), actualEnd: at(-3), approvedAt: at(-1) });
    await mk("done late", { status: "COMPLETED", scheduledEnd: at(-5), actualEnd: at(-1), approvedAt: at(-0.5) });
    await mk("done long ago", { status: "COMPLETED", scheduledEnd: at(-24 * 70), actualEnd: at(-24 * 70), approvedAt: at(-24 * 70) });
    await mk("deleted", { deletedAt: at(-1) });

    const { taskDashboard } = await import("@/server/dashboards/tasks");
    const t = await taskDashboard({ team: null, client: null, period: "MONTH" }, now);
    expect(t.open).toBe(6);
    expect(Object.fromEntries(t.byState.map((s) => [s.key, s.count]))).toEqual({ green: 1, red: 1, yellow: 1, purple: 1, white: 2 });
    expect(t.byState.map((s) => s.label)).toEqual(["Started", "Late to start", "Paused", "Doubt", "Not started"]);
    expect(t.openMinutes).toBe(120 + 60 + 60 + 60 + 90); // the meeting counts as a task, not hours
    expect(t).toMatchObject({ completed: 2, onTimePct: 50 });
    expect(t.byTeam.map((b) => [b.label, b.value, b.sub])).toEqual([["Graphic", 300, "5 open"], ["SEO", 90, "1 open"]]);
    expect(t.byClient.map((b) => [b.label, b.value])).toEqual([["Repo", 300], ["Zenith", 90]]);

    const g = await taskDashboard({ team: seed.team.id, client: null, period: "MONTH" }, now);
    expect(g.open).toBe(5);
    const z = await taskDashboard({ team: null, client: zenith.id, period: "MONTH" }, now);
    expect(z).toMatchObject({ open: 1, openMinutes: 90, completed: 0, onTimePct: null });
    const fy = await taskDashboard({ team: null, client: null, period: "FY" }, now);
    expect(fy.completed).toBeGreaterThanOrEqual(2);
  });
});
