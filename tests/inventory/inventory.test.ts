import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { parseDateKey } from "@/lib/time";

type Seed = Awaited<ReturnType<typeof seedBasics>>;
const TZ = "Asia/Kolkata";
const NOW = new Date("2026-09-10T05:00:00Z"); // Thu 10:30 IST
const day = (k: string) => parseDateKey(k, TZ);

describe("inventoryFor", () => {
  let seed: Seed;
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    const { invalidateSettingsCache } = await import("@/lib/settings");
    invalidateSettingsCache();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());
  afterAll(() => testDb.$disconnect());

  it("gives 480 capacity on a working day and 0 on Sunday / holiday", async () => {
    const { inventoryFor } = await import("@/server/inventory/queries");
    const { invalidateSettingsCache } = await import("@/lib/settings");
    await testDb.companySettings.update({ where: { id: "default" }, data: { holidays: [new Date("2026-09-15T00:00:00Z")] } });
    invalidateSettingsCache();
    const inv = await inventoryFor({ from: day("2026-09-13"), to: day("2026-09-15") }, { userId: seed.exec.id });
    expect(inv.days).toEqual(["2026-09-13", "2026-09-14", "2026-09-15"]);
    const byDay = Object.fromEntries(inv.rows.map((r) => [r.date, r]));
    expect(byDay["2026-09-13"].capacityMinutes).toBe(0); // Sunday
    expect(byDay["2026-09-14"]).toMatchObject({ capacityMinutes: 480, assignedMinutes: 0, sellableMinutes: 480 });
    expect(byDay["2026-09-15"].capacityMinutes).toBe(0); // holiday
    expect(inv.total).toEqual({ capacityMinutes: 480, assignedMinutes: 0, sellableMinutes: 480 });
    expect(inv.users).toHaveLength(1);
    expect(inv.teams[0]).toMatchObject({ teamId: seed.team.id, teamName: "Graphic", capacityMinutes: 480 });
    expect(inv.dayTotals.map((d) => d.capacityMinutes)).toEqual([0, 480, 0]);
  });

  it("subtracts assigned open WORK tasks (unscheduled ones land on today) and honours attendance/leave", async () => {
    const { inventoryFor } = await import("@/server/inventory/queries");
    const base = { clientId: seed.client.id, createdById: seed.admin.id, assignees: { create: [{ userId: seed.exec.id }] } };
    await testDb.task.create({ data: { ...base, title: "Mon", allocatedMinutes: 120, scheduledStart: new Date("2026-09-14T04:30:00Z"), scheduledEnd: new Date("2026-09-14T06:30:00Z") } });
    await testDb.task.create({ data: { ...base, title: "Unscheduled", allocatedMinutes: 60 } });
    await testDb.task.create({ data: { ...base, title: "Done", allocatedMinutes: 300, status: "COMPLETED", scheduledStart: new Date("2026-09-14T07:00:00Z") } });
    await testDb.task.create({ data: { ...base, title: "Meeting", type: "MEETING", allocatedMinutes: 30, scheduledStart: new Date("2026-09-14T07:00:00Z") } });
    await testDb.attendance.create({ data: { userId: seed.exec.id, date: new Date("2026-09-11T00:00:00Z"), status: "HALF_DAY" } });
    await testDb.leave.create({ data: { userId: seed.exec.id, from: new Date("2026-09-12T00:00:00Z"), to: new Date("2026-09-12T00:00:00Z"), status: "ADMIN_APPROVED" } });

    const inv = await inventoryFor({ from: day("2026-09-10"), to: day("2026-09-14") }, { teamId: seed.team.id });
    const exec = Object.fromEntries(inv.rows.filter((r) => r.userId === seed.exec.id).map((r) => [r.date, r]));
    expect(exec["2026-09-10"]).toMatchObject({ assignedMinutes: 60, sellableMinutes: 420 }); // unscheduled → today
    expect(exec["2026-09-11"]).toMatchObject({ capacityMinutes: 240 }); // half day = Settings.halfDayMinutes (default 240)
    expect(exec["2026-09-12"]).toMatchObject({ capacityMinutes: 0 }); // approved leave
    expect(exec["2026-09-14"]).toMatchObject({ capacityMinutes: 480, assignedMinutes: 120, sellableMinutes: 360 });
    expect(inv.users.map((u) => u.userId).sort()).toEqual([seed.exec.id, seed.tl.id].sort()); // team filter, HR/admin excluded
  });

  it("half day capacity comes from Settings.halfDayMinutes, even with a per-user full-day override", async () => {
    const { inventoryFor } = await import("@/server/inventory/queries");
    const { invalidateSettingsCache } = await import("@/lib/settings");
    await testDb.companySettings.update({ where: { id: "default" }, data: { halfDayMinutes: 180 } });
    invalidateSettingsCache();
    await testDb.user.update({ where: { id: seed.exec.id }, data: { dailyCapacityMinutes: 300 } });
    await testDb.attendance.create({ data: { userId: seed.exec.id, date: new Date("2026-09-14T00:00:00Z"), status: "HALF_DAY" } });
    const inv = await inventoryFor({ from: day("2026-09-14"), to: day("2026-09-15") }, { userId: seed.exec.id });
    const byDay = Object.fromEntries(inv.rows.map((r) => [r.date, r]));
    expect(byDay["2026-09-14"]).toMatchObject({ capacityMinutes: 180, sellableMinutes: 180 }); // half day from settings
    expect(byDay["2026-09-15"]).toMatchObject({ capacityMinutes: 300 }); // full day = user override
  });

  it("hourlyBreakdown marks the right hours busy and reflects attendance / leave / holiday", async () => {
    const { hourlyBreakdown } = await import("@/server/inventory/queries");
    const base = { clientId: seed.client.id, createdById: seed.admin.id };
    const forExec = { ...base, assignees: { create: [{ userId: seed.exec.id }] } };
    await testDb.task.create({ data: { ...forExec, title: "Logo", allocatedMinutes: 120, scheduledStart: new Date("2026-09-14T04:30:00Z"), scheduledEnd: new Date("2026-09-14T06:30:00Z") } }); // 10:00–12:00
    await testDb.task.create({ data: { ...forExec, title: "Reel", allocatedMinutes: 60, scheduledStart: new Date("2026-09-14T10:00:00Z"), scheduledEnd: new Date("2026-09-14T11:00:00Z") } }); // 15:30–16:30
    await testDb.task.create({ data: { ...forExec, title: "Done", allocatedMinutes: 60, status: "COMPLETED", scheduledStart: new Date("2026-09-14T11:30:00Z"), scheduledEnd: new Date("2026-09-14T12:30:00Z") } });
    await testDb.task.create({ data: { ...forExec, title: "Tomorrow", allocatedMinutes: 60, scheduledStart: new Date("2026-09-15T04:30:00Z"), scheduledEnd: new Date("2026-09-15T05:30:00Z") } });
    await testDb.task.create({ data: { ...base, title: "Sync", type: "MEETING", allocatedMinutes: 30, scheduledStart: new Date("2026-09-14T06:30:00Z"), scheduledEnd: new Date("2026-09-14T07:00:00Z"), assignees: { create: [{ userId: seed.exec.id }, { userId: seed.tl.id }] } } }); // 12:00–12:30
    await testDb.attendance.create({ data: { userId: seed.tl.id, date: new Date("2026-09-14T00:00:00Z"), status: "ABSENT" } });

    const h = await hourlyBreakdown(day("2026-09-14"), { teamId: seed.team.id });
    expect(h.date).toBe("2026-09-14");
    expect(h.hours).toEqual([600, 660, 720, 780, 840, 900, 960, 1020, 1080]);
    expect(h.lunch).toEqual({ start: 810, end: 870 });
    const exec = h.rows.find((r) => r.userId === seed.exec.id)!;
    expect(exec.status).toBe("PRESENT");
    expect(exec.cells.map((c) => c.kind)).toEqual(["assigned", "assigned", "assigned", "lunch", "lunch", "assigned", "assigned", "free", "free"]);
    expect(exec.cells[0].tasks.map((t) => t.title)).toEqual(["Logo"]);
    expect(exec.cells[2].tasks.map((t) => t.title)).toEqual(["Sync"]);
    expect(exec.cells[5].tasks.map((t) => t.title)).toEqual(["Reel"]);
    expect(exec).toMatchObject({ capacityMinutes: 480, assignedMinutes: 180, sellableMinutes: 300 }); // WORK tasks only count as assigned
    const tl = h.rows.find((r) => r.userId === seed.tl.id)!;
    expect(tl.status).toBe("ABSENT");
    expect(tl.cells.every((c) => c.kind === "off")).toBe(true);
    expect(tl.capacityMinutes).toBe(0);

    // Sunday → OFF; approved leave → LEAVE
    await testDb.leave.create({ data: { userId: seed.exec.id, from: new Date("2026-09-15T00:00:00Z"), to: new Date("2026-09-15T00:00:00Z"), status: "HR_APPROVED" } });
    const sun = await hourlyBreakdown(day("2026-09-13"), { userId: seed.exec.id });
    expect(sun.rows[0].status).toBe("OFF");
    const leave = await hourlyBreakdown(day("2026-09-15"), { userId: seed.exec.id });
    expect(leave.rows[0]).toMatchObject({ status: "LEAVE", capacityMinutes: 0 });
    expect(leave.rows[0].cells.every((c) => c.kind === "off")).toBe(true);
  });

  it("b4LeaveMinutes sums open tasks before the next approved leave", async () => {
    const { b4LeaveMinutes } = await import("@/server/inventory/queries");
    const base = { clientId: seed.client.id, createdById: seed.admin.id, assignees: { create: [{ userId: seed.exec.id }] } };
    await testDb.task.create({ data: { ...base, title: "Before", allocatedMinutes: 90, scheduledStart: new Date("2026-09-14T04:30:00Z") } });
    await testDb.task.create({ data: { ...base, title: "Unscheduled", allocatedMinutes: 30 } });
    await testDb.task.create({ data: { ...base, title: "After", allocatedMinutes: 500, scheduledStart: new Date("2026-09-25T04:30:00Z") } });
    expect(await b4LeaveMinutes(seed.exec.id)).toBe(0); // no leave yet
    await testDb.leave.create({ data: { userId: seed.exec.id, from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-22T00:00:00Z"), status: "HR_APPROVED" } });
    expect(await b4LeaveMinutes(seed.exec.id)).toBe(120);
  });

  it("nightly job snapshots 31 days per user and per team", async () => {
    const { run } = await import("@/jobs/inventory");
    const r = await run();
    // 3 task-role users (admin, tl, exec) + 1 team, 31 days each
    expect(r.snapshots).toBe(4 * 31);
    expect(await testDb.inventorySnapshot.count()).toBe(4 * 31);
    const teamRow = await testDb.inventorySnapshot.findFirst({ where: { teamId: seed.team.id, date: new Date("2026-09-14T00:00:00Z") } });
    expect(teamRow).toMatchObject({ userId: null, capacityMinutes: 960, sellableMinutes: 960 });
    // re-run replaces rather than duplicates
    await run();
    expect(await testDb.inventorySnapshot.count()).toBe(4 * 31);
  });
});
