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
    expect(exec["2026-09-11"]).toMatchObject({ capacityMinutes: 240 }); // half day
    expect(exec["2026-09-12"]).toMatchObject({ capacityMinutes: 0 }); // approved leave
    expect(exec["2026-09-14"]).toMatchObject({ capacityMinutes: 480, assignedMinutes: 120, sellableMinutes: 360 });
    expect(inv.users.map((u) => u.userId).sort()).toEqual([seed.exec.id, seed.tl.id].sort()); // team filter, HR/admin excluded
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
