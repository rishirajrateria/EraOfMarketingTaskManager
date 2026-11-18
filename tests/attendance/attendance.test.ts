import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();
type Seed = Awaited<ReturnType<typeof seedBasics>>;

const NOW = new Date("2026-09-10T05:00:00Z"); // Thu 10:30 IST

describe("attendance", () => {
  let seed: Seed;
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    session.clear();
  });
  afterAll(() => testDb.$disconnect());

  it("has no self check-in / check-out actions (attendance is marked by HR/Admin only)", async () => {
    const actions = (await import("@/server/attendance/actions")) as Record<string, unknown>;
    expect(actions.checkIn).toBeUndefined();
    expect(actions.checkOut).toBeUndefined();
    expect(typeof actions.markAttendance).toBe("function");
    expect(typeof actions.exportAttendanceCsv).toBe("function");
  });

  it("HR marks a user ABSENT with audit, and the grid/CSV reflect it", async () => {
    const { markAttendance, exportAttendanceCsv } = await import("@/server/attendance/actions");
    const { attendanceMonth } = await import("@/server/attendance/queries");
    session.set(seed.hr);
    const r = await markAttendance({ userId: seed.exec.id, date: "2026-09-09", status: "ABSENT", note: "No show" });
    expect(r.ok).toBe(true);
    const row = await testDb.attendance.findUnique({ where: { userId_date: { userId: seed.exec.id, date: new Date("2026-09-09T00:00:00Z") } } });
    expect(row?.status).toBe("ABSENT");
    expect(row?.markedById).toBe(seed.hr.id);
    const log = await testDb.auditLog.findFirst({ where: { action: "attendance.mark" } });
    expect(log?.before).toBeNull();
    expect((log?.after as { status: string }).status).toBe("ABSENT");

    // correction with times
    const fix = await markAttendance({ userId: seed.exec.id, date: "2026-09-09", status: "PRESENT", checkIn: "10:15", checkOut: "19:00" });
    expect(fix.ok).toBe(true);
    const fixed = await testDb.attendance.findFirst({ where: { userId: seed.exec.id } });
    expect(fixed?.checkIn?.toISOString()).toBe("2026-09-09T04:45:00.000Z"); // 10:15 IST
    const log2 = await testDb.auditLog.findFirst({ where: { action: "attendance.mark" }, orderBy: { createdAt: "desc" } });
    expect((log2?.before as { status: string }).status).toBe("ABSENT");

    const grid = await attendanceMonth({ id: seed.hr.id, role: "HR", teamId: null, teamLeaderId: null }, { month: "2026-09" });
    expect(grid.days).toHaveLength(30);
    expect(grid.days.find((d) => d.key === "2026-09-13")?.working).toBe(false); // Sunday
    expect(grid.cells[seed.exec.id]["2026-09-09"]).toMatchObject({ status: "PRESENT", checkIn: "10:15am", explicit: true });

    const csv = await exportAttendanceCsv({ month: "2026-09", userId: seed.exec.id });
    expect(csv.ok && csv.data.csv).toContain('"Arush","Graphic",2026-09-09,PRESENT,"10:15am","7:00pm"');
  });

  it("executives and team leaders cannot mark anyone (not even themselves)", async () => {
    const { markAttendance } = await import("@/server/attendance/actions");
    const { canMarkAttendance } = await import("@/server/attendance/queries");
    for (const who of [seed.exec, seed.tl]) {
      session.set(who);
      const own = await markAttendance({ userId: who.id, date: "2026-09-10", status: "PRESENT", checkIn: "10:00" });
      expect(own.ok).toBe(false);
      expect(!own.ok && own.error).toMatch(/Requires role/);
      const other = await markAttendance({ userId: seed.tl.id, date: "2026-09-09", status: "ABSENT" });
      expect(other.ok).toBe(false);
    }
    expect(await testDb.attendance.count()).toBe(0);
    expect(canMarkAttendance({ id: seed.exec.id, role: "EXECUTIVE", teamId: null, teamLeaderId: null })).toBe(false);
    expect(canMarkAttendance({ id: seed.tl.id, role: "TEAM_LEADER", teamId: null, teamLeaderId: null })).toBe(false);
    expect(canMarkAttendance({ id: seed.hr.id, role: "HR", teamId: null, teamLeaderId: null })).toBe(true);
    expect(canMarkAttendance({ id: seed.admin.id, role: "ADMIN", teamId: null, teamLeaderId: null })).toBe(true);
  });

  it("HR cannot change a day covered by an approved leave; Admin can", async () => {
    const { markAttendance } = await import("@/server/attendance/actions");
    await testDb.leave.create({ data: { userId: seed.exec.id, from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-22T00:00:00Z"), status: "HR_APPROVED" } });
    session.set(seed.hr);
    const denied = await markAttendance({ userId: seed.exec.id, date: "2026-09-21", status: "PRESENT" });
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.error).toMatch(/approved leave/);
    // HR may still record the LEAVE status itself
    const asLeave = await markAttendance({ userId: seed.exec.id, date: "2026-09-21", status: "LEAVE" });
    expect(asLeave.ok).toBe(true);
    session.set(seed.admin);
    const admin = await markAttendance({ userId: seed.exec.id, date: "2026-09-22", status: "HALF_DAY", checkIn: "14:30" });
    expect(admin.ok).toBe(true);
  });

  it("grid shows approved leave and holidays, and non-Admin/HR only see themselves (read-only)", async () => {
    const { attendanceMonth, canSeeAllAttendance } = await import("@/server/attendance/queries");
    const { exportAttendanceCsv } = await import("@/server/attendance/actions");
    const { invalidateSettingsCache } = await import("@/lib/settings");
    await testDb.leave.create({ data: { userId: seed.exec.id, from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-22T00:00:00Z"), status: "HR_APPROVED" } });
    await testDb.companySettings.update({ where: { id: "default" }, data: { holidays: [new Date("2026-09-15T00:00:00Z")] } });
    invalidateSettingsCache();
    const viewer = { id: seed.exec.id, role: "EXECUTIVE" as const, teamId: seed.team.id, teamLeaderId: seed.tl.id };
    expect(canSeeAllAttendance(viewer)).toBe(false);
    const grid = await attendanceMonth(viewer, { month: "2026-09", userId: seed.tl.id });
    expect(grid.users.map((u) => u.id)).toEqual([seed.exec.id]);
    expect(grid.cells[seed.exec.id]["2026-09-21"].status).toBe("LEAVE");
    expect(grid.cells[seed.exec.id]["2026-09-22"].status).toBe("LEAVE");
    expect(grid.cells[seed.exec.id]["2026-09-15"].status).toBe("HOLIDAY");
    expect(grid.days.find((d) => d.key === "2026-09-15")?.holiday).toBe(true);

    // staff can export their own month but nobody else's
    session.set(seed.exec);
    const own = await exportAttendanceCsv({ month: "2026-09" });
    expect(own.ok && own.data.csv).toContain('"Arush","Graphic",2026-09-21,LEAVE');
    const other = await exportAttendanceCsv({ month: "2026-09", userId: seed.tl.id });
    expect(other.ok).toBe(false);
  });
});
