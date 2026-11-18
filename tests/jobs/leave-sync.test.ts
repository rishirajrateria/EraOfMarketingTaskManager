import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";

describe("leave sync from Google Calendar", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("maps all-day and timed events to inclusive local date ranges", async () => {
    const { eventToRange } = await import("@/jobs/leave-sync");
    expect(eventToRange({ id: "1", summary: "Leave", start: "2026-09-21", end: "2026-09-23", allDay: true }, "Asia/Kolkata")).toEqual({ from: "2026-09-21", to: "2026-09-22" });
    expect(eventToRange({ id: "2", summary: "OOO", start: "2026-09-21T04:30:00Z", end: "2026-09-21T13:30:00Z", allDay: false }, "Asia/Kolkata")).toEqual({ from: "2026-09-21", to: "2026-09-21" });
  });

  it("creates a REQUESTED leave + HR request once per event and skips overlaps", async () => {
    const { exec, hr } = await seedBasics();
    const { importLeaveEvents } = await import("@/jobs/leave-sync");
    const events = [{ id: "evt1", summary: "Leave - family", start: "2026-10-05", end: "2026-10-07", allDay: true }];
    expect(await importLeaveEvents(exec.id, events, "Asia/Kolkata")).toBe(1);
    const leave = await testDb.leave.findFirstOrThrow({ where: { userId: exec.id } });
    expect(leave.status).toBe("REQUESTED");
    expect(leave.calendarEventId).toBe("evt1");
    expect(await testDb.request.count({ where: { leaveId: leave.id, type: "LEAVE", targetRole: "HR" } })).toBe(1);
    expect(await testDb.notification.count({ where: { userId: hr.id, kind: "LEAVE_REQUESTED" } })).toBe(1);
    // same event again → nothing; overlapping different event → nothing
    expect(await importLeaveEvents(exec.id, events, "Asia/Kolkata")).toBe(0);
    expect(await importLeaveEvents(exec.id, [{ id: "evt2", summary: "OOO", start: "2026-10-06", end: "2026-10-09", allDay: true }], "Asia/Kolkata")).toBe(0);
    expect(await testDb.leave.count({ where: { userId: exec.id } })).toBe(1);
  });

  it("run() is a no-op in mock mode", async () => {
    await seedBasics();
    const { run } = await import("@/jobs/leave-sync");
    const r = await run();
    expect(r.created).toBe(0);
    expect(r.errors).toBe(0);
  });
});
