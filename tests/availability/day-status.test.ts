/**
 * ADR 0019 — `personDayStatus` precedence and everything that reads it: the attendance grid, the HR tile, leave
 * shifting, the timezone of `@db.Date` keys, the "is off that day" warning. Items 4–8 of the availability audit.
 * Time is frozen on Monday 12 Oct 2026, 09:00 in Asia/Kolkata.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { createTaskAs, settle } from "../tasks/helpers";
import { dateKey, parseDateKey, zonedDayAt } from "@/lib/time";
import { DEFAULT_WORKING } from "@/lib/working-time";
import { toDbDate, toWorkingConfig } from "@/server/inventory/compute";
import { personDayStatus } from "@/server/availability/day-status";

const session = mockSession();
const TZ = "Asia/Kolkata";
const SUN = "2026-10-11";
const MON = "2026-10-12";
const TUE = "2026-10-13";
const WED = "2026-10-14";
const at = (key: string, min: number, tz = TZ) => zonedDayAt(parseDateKey(key, tz), min, tz);
let seed: Awaited<ReturnType<typeof seedBasics>>;

describe("personDayStatus (pure)", () => {
  const cfg = { ...DEFAULT_WORKING, holidays: [TUE], halfDayMinutes: 240 };
  const user = { dailyCapacityMinutes: null, workingDays: [1, 2, 3, 4, 5, 6] };
  const day = (dayKey: string, extra: Partial<Parameters<typeof personDayStatus>[0]> = {}) => personDayStatus({ user, dayKey, cfg, onLeave: false, ...extra });

  it("4. precedence: approved leave > company holiday > weekly off > attendance row > working", () => {
    expect(day(TUE, { onLeave: true }).kind).toBe("LEAVE"); // leave beats the holiday
    expect(day(TUE, { attendance: { status: "ABSENT" } }).kind).toBe("HOLIDAY"); // holiday beats the row
    expect(day(SUN, { attendance: { status: "HALF_DAY" } }).kind).toBe("OFF_WEEKLY"); // weekly off beats the row
    expect(day(MON, { attendance: { status: "ABSENT" } })).toMatchObject({ kind: "ABSENT", capacityMinutes: 0, window: [] });
    expect(day(MON, { attendance: { status: "LEAVE" } }).kind).toBe("LEAVE");
    expect(day(MON, { attendance: { status: "HOLIDAY" } }).kind).toBe("HOLIDAY");
    expect(day(MON)).toMatchObject({ kind: "WORKING", capacityMinutes: 480, presentOnOffDay: false });
    expect(day(MON, { user: { dailyCapacityMinutes: 300, workingDays: [] } }).capacityMinutes).toBe(300);
    expect(day(MON, { user: { dailyCapacityMinutes: null, workingDays: [2, 3] } }).kind).toBe("OFF_WEEKLY");
  });

  it("4. a PRESENT row on a leave / holiday / weekly-off day is flagged, never counted as present", () => {
    expect(day(MON, { onLeave: true, attendance: { status: "PRESENT" } })).toMatchObject({ kind: "LEAVE", capacityMinutes: 0, presentOnOffDay: true, marked: "PRESENT" });
    expect(day(TUE, { attendance: { status: "PRESENT" } })).toMatchObject({ kind: "HOLIDAY", presentOnOffDay: true });
    expect(day(SUN, { attendance: { status: "PRESENT" } })).toMatchObject({ kind: "OFF_WEEKLY", presentOnOffDay: true });
    expect(day(TUE, { attendance: { status: "ABSENT" } }).presentOnOffDay).toBe(false);
  });

  it("1. HALF_DAY: half capacity, first half of the day unless check-in / out are set", () => {
    const half = day(MON, { attendance: { status: "HALF_DAY" } });
    expect(half).toMatchObject({ kind: "HALF", capacityMinutes: 240 });
    expect(half.window.map((w) => [w.start.getTime(), w.end.getTime()])).toEqual([
      [at(MON, 600).getTime(), at(MON, 810).getTime()],
      [at(MON, 870).getTime(), at(MON, 900).getTime()],
    ]);
    const timed = day(MON, { attendance: { status: "HALF_DAY", checkIn: at(MON, 900), checkOut: at(MON, 1080) } });
    expect(timed.capacityMinutes).toBe(180);
    expect(timed.window[0].start.getTime()).toBe(at(MON, 900).getTime());
  });
});

describe("availability across screens (DB)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(MON, 540));
    await resetDb();
    seed = await seedBasics();
    (await import("@/lib/settings")).invalidateSettingsCache();
  });
  afterEach(async () => {
    await settle(100);
    vi.useRealTimers();
  });

  it("4. the attendance grid, the HR tile and inventory use the same precedence", async () => {
    await testDb.companySettings.update({ where: { id: "default" }, data: { holidays: [toDbDate(TUE)] } });
    (await import("@/lib/settings")).invalidateSettingsCache();
    await testDb.leave.create({ data: { userId: seed.exec.id, from: toDbDate(MON), to: toDbDate(MON), status: "HR_APPROVED" } });
    await testDb.attendance.create({ data: { userId: seed.exec.id, date: toDbDate(MON), status: "PRESENT" } });
    await testDb.attendance.create({ data: { userId: seed.tl.id, date: toDbDate(TUE), status: "ABSENT" } });

    const { attendanceMonth } = await import("@/server/attendance/queries");
    const grid = await attendanceMonth({ id: seed.admin.id, role: "ADMIN", teamId: null, teamLeaderId: null }, { month: "2026-10" });
    expect(grid.cells[seed.exec.id][MON]).toMatchObject({ status: "LEAVE", marked: "PRESENT", explicit: true, warning: "Marked present on an approved leave day" });
    expect(grid.cells[seed.tl.id][TUE]).toMatchObject({ status: "HOLIDAY", marked: "ABSENT", warning: null });
    expect(grid.cells[seed.tl.id][WED]).toBeUndefined();

    const { hrDashboard } = await import("@/server/dashboards/hr");
    const mon = await hrDashboard({ team: null, period: "MONTH" }, at(MON, 600));
    const by = (h: typeof mon, id: string) => h.people.find((p) => p.userId === id)!;
    expect(by(mon, seed.exec.id)).toMatchObject({ today: "LEAVE", todayWarning: true });
    expect(by(mon, seed.tl.id)).toMatchObject({ today: "NONE", todayWarning: false });
    const tue = await hrDashboard({ team: null, period: "MONTH" }, at(TUE, 600));
    expect(by(tue, seed.tl.id).today).toBe("HOLIDAY");
    const sun = await hrDashboard({ team: null, period: "MONTH" }, at(SUN, 600));
    expect(by(sun, seed.exec.id).today).toBe("OFF");

    const { inventoryFor } = await import("@/server/inventory/queries");
    const inv = await inventoryFor({ from: parseDateKey(MON, TZ), to: parseDateKey(TUE, TZ) });
    const row = (u: string, k: string) => inv.rows.find((r) => r.userId === u && r.date === k)!;
    expect(row(seed.exec.id, MON)).toMatchObject({ kind: "LEAVE", capacityMinutes: 0 });
    expect(row(seed.tl.id, TUE)).toMatchObject({ kind: "HOLIDAY", capacityMinutes: 0 });
  });

  it("5. leave shift never moves started tasks or meetings, moves the rest after the leave, and keeps the leave open", async () => {
    const task = (title: string, extra: Record<string, unknown> = {}) =>
      testDb.task.create({
        data: {
          title,
          clientId: seed.client.id,
          createdById: seed.tl.id,
          assignedById: seed.tl.id,
          allocatedMinutes: 60,
          scheduledStart: at(TUE, 600),
          scheduledEnd: at(TUE, 660),
          assignees: { create: [{ userId: seed.exec.id }] },
          ...extra,
        },
      });
    const movable = await task("Banner");
    const started = await task("Copy", { status: "STARTED", scheduledStart: at(TUE, 660), scheduledEnd: at(TUE, 720) });
    const meeting = await task("Call", { type: "MEETING", scheduledStart: at(TUE, 720), scheduledEnd: at(TUE, 780) });
    const leave = await testDb.leave.create({ data: { userId: seed.exec.id, from: toDbDate(TUE), to: toDbDate(TUE), status: "ADMIN_APPROVED" } });

    const { tasksAffectedByLeave } = await import("@/server/scheduling/shift");
    const affected = await tasksAffectedByLeave(leave.id);
    expect(affected.map((a) => [a.title, a.movable, a.why])).toEqual([["Banner", true, null], ["Copy", false, "started"], ["Call", false, "meeting"]]);

    session.set(seed.admin);
    const { shiftLeaveTasks } = await import("@/server/leave/actions");
    const r = await shiftLeaveTasks(leave.id);
    expect(r.ok && r.data).toEqual({ shifted: 1, remaining: 2 });
    const moved = await testDb.task.findUniqueOrThrow({ where: { id: movable.id } });
    // Monday is free, but a moved task never lands before the leave or its original start
    expect(dateKey(moved.scheduledStart!, TZ)).toBe(WED);
    expect(moved.scheduledStart!.getTime()).toBe(at(WED, 600).getTime());
    for (const id of [started.id, meeting.id]) expect((await testDb.task.findUniqueOrThrow({ where: { id } })).scheduledStart!.getTime()).not.toBe(moved.scheduledStart!.getTime());
    expect((await testDb.task.findUniqueOrThrow({ where: { id: started.id } })).scheduledStart!.getTime()).toBe(at(TUE, 660).getTime());
    expect((await testDb.leave.findUniqueOrThrow({ where: { id: leave.id } })).tasksShiftedAt).toBeNull();

    const { leaveInbox } = await import("@/server/leave/queries");
    const inbox = await leaveInbox();
    expect(inbox.needsShift.map((l) => [l.id, l.affected.length, l.affected.every((a) => !a.movable)])).toEqual([[leave.id, 2, true]]);

    const { shiftTaskToNextSlot } = await import("@/server/scheduling/slot");
    expect(await shiftTaskToNextSlot(started.id, seed.admin.id, "test")).toBeNull();
    expect(await shiftTaskToNextSlot(meeting.id, seed.admin.id, "test")).toBeNull();

    // once the owner moves them, a shift closes the leave
    await testDb.task.updateMany({ where: { id: { in: [started.id, meeting.id] } }, data: { scheduledStart: at(WED, 900), scheduledEnd: at(WED, 960) } });
    const done = await shiftLeaveTasks(leave.id);
    expect(done.ok && done.data).toEqual({ shifted: 0, remaining: 0 });
    expect((await testDb.leave.findUniqueOrThrow({ where: { id: leave.id } })).tasksShiftedAt).not.toBeNull();
  });

  it("6. holiday and leave day keys use fromDbDate everywhere, even west of UTC", async () => {
    const LA = "America/Los_Angeles";
    await testDb.companySettings.update({ where: { id: "default" }, data: { timezone: LA, holidays: [toDbDate(WED)] } });
    (await import("@/lib/settings")).invalidateSettingsCache();
    await testDb.leave.create({ data: { userId: seed.exec.id, from: toDbDate(TUE), to: toDbDate(TUE), status: "ADMIN_APPROVED" } });
    const { leaveDayKeys, workingConfig } = await import("@/server/scheduling/slot");
    expect((await workingConfig()).holidays).toEqual([WED]);
    expect(await leaveDayKeys(seed.exec.id, at(MON, 0, LA), at(WED, 0, LA), LA)).toEqual(new Set([TUE]));
    expect(toWorkingConfig(await (await import("@/lib/settings")).getSettings()).holidays).toEqual([WED]);

    const { inventoryFor } = await import("@/server/inventory/queries");
    const inv = await inventoryFor({ from: parseDateKey(MON, LA), to: parseDateKey(WED, LA) }, { userId: seed.exec.id });
    expect(inv.rows.map((r) => [r.date, r.kind])).toEqual([[MON, "WORKING"], [TUE, "LEAVE"], [WED, "HOLIDAY"]]);
    const { proposeSlot } = await import("@/server/scheduling/slot");
    const p = await proposeSlot([seed.exec.id], 60, { requesterRole: "ADMIN", requesterId: seed.admin.id, from: at(TUE, 0, LA) });
    expect(dateKey(p!.start, LA)).toBe("2026-10-15"); // Tue = leave, Wed = holiday in the company zone
    expect(p!.start.getTime()).toBe(at("2026-10-15", 600, LA).getTime());
  });

  it("7. a manual start on someone's day off warns but still saves", async () => {
    await testDb.leave.create({ data: { userId: seed.tl.id, from: toDbDate(TUE), to: toDbDate(TUE), status: "ADMIN_APPROVED" } });
    session.set(seed.admin);
    const { offDayWarnings } = await import("@/server/availability/actions");
    const tue = await offDayWarnings([seed.tl.id, seed.exec.id], at(TUE, 660).toISOString());
    expect(tue.ok && tue.data.map((w) => [w.message, w.kind])).toEqual([["Rishi is off that day", "LEAVE"]]);
    const sun = await offDayWarnings([seed.exec.id], SUN);
    expect(sun.ok && sun.data.map((w) => w.message)).toEqual(["Arush is off that day"]);
    const mon = await offDayWarnings([seed.tl.id], MON);
    expect(mon.ok && mon.data).toEqual([]);

    const id = await createTaskAs(seed.client.id, [seed.tl.id], { scheduledStart: at(TUE, 660).toISOString(), allocatedMinutes: 60 });
    const t = await testDb.task.findUniqueOrThrow({ where: { id } });
    expect(t.scheduledStart!.getTime()).toBe(at(TUE, 660).getTime());
    // and it shows as overbooked on that day instead of disappearing
    const { inventoryFor } = await import("@/server/inventory/queries");
    const inv = await inventoryFor({ from: parseDateKey(TUE, TZ), to: parseDateKey(TUE, TZ) }, { userId: seed.tl.id });
    expect(inv.rows[0]).toMatchObject({ capacityMinutes: 0, assignedMinutes: 60, overbookedMinutes: 60 });
  });

  it("8. the dead periodLoads action is gone", async () => {
    const create = await import("@/server/tasks/create");
    const queries = await import("@/server/tasks/queries");
    expect("periodLoads" in create).toBe(false);
    expect("periodLoad" in queries).toBe(false);
  });
});
