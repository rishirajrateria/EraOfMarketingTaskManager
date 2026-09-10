import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();
type Seed = Awaited<ReturnType<typeof seedBasics>>;

const MORNING = new Date("2026-09-10T05:00:00Z"); // Thu 10:30 IST
const AFTERNOON = new Date("2026-09-10T09:00:00Z"); // Thu 14:30 IST

describe("attendance", () => {
  let seed: Seed;
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(MORNING);
  });
  afterEach(() => {
    vi.useRealTimers();
    session.clear();
  });
  afterAll(() => testDb.$disconnect());

  it("check-in creates today's row as PRESENT and check-out stamps the time", async () => {
    const { checkIn, checkOut } = await import("@/server/attendance/actions");
    session.set(seed.exec);
    const r = await checkIn();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual({ date: "2026-09-10", status: "PRESENT" });
    const row = await testDb.attendance.findUnique({ where: { userId_date: { userId: seed.exec.id, date: new Date("2026-09-10T00:00:00Z") } } });
    expect(row?.status).toBe("PRESENT");
    expect(row?.checkIn?.toISOString()).toBe(MORNING.toISOString());
    expect(row?.checkOut).toBeNull();

    // idempotent second check-in
    const again = await checkIn();
    expect(again.ok && again.data.status).toBe("PRESENT");
    expect(await testDb.attendance.count()).toBe(1);

    vi.setSystemTime(new Date("2026-09-10T13:00:00Z"));
    const out = await checkOut();
    expect(out.ok).toBe(true);
    const after = await testDb.attendance.findFirst({ where: { userId: seed.exec.id } });
    expect(after?.checkOut?.toISOString()).toBe("2026-09-10T13:00:00.000Z");
    expect(await testDb.auditLog.count({ where: { entityType: "Attendance" } })).toBe(2);
  });

  it("check-in after 14:00 local is a HALF_DAY", async () => {
    const { checkIn } = await import("@/server/attendance/actions");
    vi.setSystemTime(AFTERNOON);
    session.set(seed.tl);
    const r = await checkIn();
    expect(r.ok && r.data.status).toBe("HALF_DAY");
  });

  it("check-out without check-in fails", async () => {
    const { checkOut } = await import("@/server/attendance/actions");
    session.set(seed.exec);
    const r = await checkOut();
    expect(r.ok).toBe(false);
  });

  it("HR marks a user ABSENT with audit, and the grid/CSV reflect it; executives cannot mark", async () => {
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

    session.set(seed.exec);
    const denied = await markAttendance({ userId: seed.tl.id, date: "2026-09-09", status: "ABSENT" });
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.error).toMatch(/Requires role/);
  });

  it("grid shows approved leave and holidays, and non-Admin/HR only see themselves", async () => {
    const { attendanceMonth } = await import("@/server/attendance/queries");
    const { invalidateSettingsCache } = await import("@/lib/settings");
    await testDb.leave.create({ data: { userId: seed.exec.id, from: new Date("2026-09-21T00:00:00Z"), to: new Date("2026-09-22T00:00:00Z"), status: "HR_APPROVED" } });
    await testDb.companySettings.update({ where: { id: "default" }, data: { holidays: [new Date("2026-09-15T00:00:00Z")] } });
    invalidateSettingsCache();
    const grid = await attendanceMonth({ id: seed.exec.id, role: "EXECUTIVE", teamId: seed.team.id, teamLeaderId: seed.tl.id }, { month: "2026-09", userId: seed.tl.id });
    expect(grid.users.map((u) => u.id)).toEqual([seed.exec.id]);
    expect(grid.cells[seed.exec.id]["2026-09-21"].status).toBe("LEAVE");
    expect(grid.cells[seed.exec.id]["2026-09-22"].status).toBe("LEAVE");
    expect(grid.cells[seed.exec.id]["2026-09-15"].status).toBe("HOLIDAY");
    expect(grid.days.find((d) => d.key === "2026-09-15")?.holiday).toBe(true);
  });
});
