import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();
type Seed = Awaited<ReturnType<typeof seedBasics>>;

const NOW = new Date("2026-09-10T05:00:00Z");
const FROM = "2026-09-21";
const TO = "2026-09-22";

async function createTaskInWindow(seed: Seed, userId: string) {
  return testDb.task.create({
    data: {
      title: "Banner set",
      clientId: seed.client.id,
      createdById: seed.admin.id,
      allocatedMinutes: 120,
      scheduledStart: new Date("2026-09-21T04:30:00Z"), // 10:00 IST on the first leave day
      scheduledEnd: new Date("2026-09-21T06:30:00Z"),
      assignees: { create: [{ userId }] },
    },
  });
}

describe("leave flow", () => {
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

  it("exec requests → HR notified → HR approves → HR_APPROVED, request resolved, calendar block, user notified", async () => {
    const { requestLeave, hrApprove } = await import("@/server/leave/actions");
    session.set(seed.exec);
    const r = await requestLeave({ from: FROM, to: TO, reason: "Family" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const leave = await testDb.leave.findUniqueOrThrow({ where: { id: r.data.leaveId } });
    expect(leave.status).toBe("REQUESTED");
    expect(leave.from.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    const req = await testDb.request.findFirstOrThrow({ where: { leaveId: leave.id } });
    expect(req).toMatchObject({ type: "LEAVE", targetRole: "HR", status: "OPEN", raisedById: seed.exec.id });
    const hrNotes = await testDb.notification.findMany({ where: { kind: "LEAVE_REQUESTED" } });
    expect(hrNotes.map((n) => n.userId).sort()).toEqual([seed.admin.id, seed.hr.id].sort());

    session.set(seed.hr);
    const a = await hrApprove(leave.id);
    expect(a.ok).toBe(true);
    expect(a.ok && a.data).toEqual({ status: "HR_APPROVED", affectedTasks: 0 });
    const approved = await testDb.leave.findUniqueOrThrow({ where: { id: leave.id } });
    expect(approved.status).toBe("HR_APPROVED");
    expect(approved.hrApprovedById).toBe(seed.hr.id);
    expect(approved.calendarEventId).toMatch(/^evt_/);
    const resolved = await testDb.request.findUniqueOrThrow({ where: { id: req.id } });
    expect(resolved.status).toBe("APPROVED");
    expect(resolved.resolvedById).toBe(seed.hr.id);
    expect(resolved.resolvedAt).not.toBeNull();
    expect(await testDb.notification.count({ where: { userId: seed.exec.id, kind: "LEAVE_APPROVED" } })).toBe(1);
    expect(await testDb.notification.count({ where: { kind: "GENERIC" } })).toBe(0);
    // cannot approve twice
    const twice = await hrApprove(leave.id);
    expect(twice.ok).toBe(false);
  });

  it("Admin approving sets ADMIN_APPROVED and admins are prompted when tasks fall in the window", async () => {
    const { requestLeave, hrApprove, shiftLeaveTasks } = await import("@/server/leave/actions");
    const { leaveInbox } = await import("@/server/leave/queries");
    await createTaskInWindow(seed, seed.tl.id);
    session.set(seed.tl);
    const r = await requestLeave({ from: FROM, to: TO });
    if (!r.ok) throw new Error(r.error);
    session.set(seed.admin);
    const a = await hrApprove(r.data.leaveId);
    expect(a.ok && a.data).toEqual({ status: "ADMIN_APPROVED", affectedTasks: 1 });
    const prompt = await testDb.notification.findFirst({ where: { kind: "GENERIC", userId: seed.admin.id } });
    expect(prompt?.title).toBe("Leave approved — 1 task needs shifting");
    expect(prompt?.href).toBe(`/requests/leave?leaveId=${r.data.leaveId}`);

    const inbox = await leaveInbox();
    expect(inbox.pending).toHaveLength(0);
    expect(inbox.needsShift.map((l) => l.id)).toEqual([r.data.leaveId]);
    expect(inbox.needsShift[0].affected[0].title).toBe("Banner set");

    session.set(seed.hr);
    const denied = await shiftLeaveTasks(r.data.leaveId);
    expect(denied.ok).toBe(false);

    session.set(seed.admin);
    const shifted = await shiftLeaveTasks(r.data.leaveId);
    expect(shifted.ok).toBe(true);
    const after = await testDb.leave.findUniqueOrThrow({ where: { id: r.data.leaveId } });
    expect(after.tasksShiftedAt).not.toBeNull();
    expect((await leaveInbox()).needsShift).toHaveLength(0);
  });

  it("HR rejects with a note; user is notified", async () => {
    const { requestLeave, hrReject } = await import("@/server/leave/actions");
    session.set(seed.exec);
    const r = await requestLeave({ from: FROM, to: TO });
    if (!r.ok) throw new Error(r.error);
    session.set(seed.hr);
    const rej = await hrReject(r.data.leaveId, "Peak week");
    expect(rej.ok && rej.data.status).toBe("REJECTED");
    const req = await testDb.request.findFirstOrThrow({ where: { leaveId: r.data.leaveId } });
    expect(req).toMatchObject({ status: "REJECTED", resolutionNote: "Peak week", resolvedById: seed.hr.id });
    const note = await testDb.notification.findFirst({ where: { userId: seed.exec.id, kind: "LEAVE_REJECTED" } });
    expect(note?.body).toContain("Peak week");
  });

  it("validates dates and rejects inactive users", async () => {
    const { requestLeave } = await import("@/server/leave/actions");
    session.set(seed.exec);
    expect((await requestLeave({ from: TO, to: FROM })).ok).toBe(false);
    expect((await requestLeave({ from: "21/09/2026", to: TO })).ok).toBe(false);
    await testDb.user.update({ where: { id: seed.exec.id }, data: { active: false } });
    expect((await requestLeave({ from: FROM, to: TO })).ok).toBe(false);
  });

  it("changes to an approved leave go through Admin; HR cannot resolve them", async () => {
    const { requestLeave, hrApprove, requestLeaveChange, resolveLeaveChange } = await import("@/server/leave/actions");
    session.set(seed.exec);
    const r = await requestLeave({ from: FROM, to: TO });
    if (!r.ok) throw new Error(r.error);
    // not yet approved → no change request needed
    expect((await requestLeaveChange(r.data.leaveId, { cancel: true })).ok).toBe(false);

    session.set(seed.hr);
    expect((await hrApprove(r.data.leaveId)).ok).toBe(true);

    session.set(seed.tl); // someone else's leave
    expect((await requestLeaveChange(r.data.leaveId, { cancel: true })).ok).toBe(false);

    session.set(seed.exec);
    const c = await requestLeaveChange(r.data.leaveId, { from: "2026-09-22", to: "2026-09-23", reason: "Shifted a day" });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const req = await testDb.request.findUniqueOrThrow({ where: { id: c.data.requestId } });
    expect(req).toMatchObject({ type: "APPROVED_CHANGE", targetRole: "ADMIN", status: "OPEN" });
    expect(await testDb.notification.count({ where: { userId: seed.admin.id, kind: "GENERIC" } })).toBe(1);
    // only one pending change at a time
    expect((await requestLeaveChange(r.data.leaveId, { cancel: true })).ok).toBe(false);

    session.set(seed.hr);
    const denied = await resolveLeaveChange(c.data.requestId, true);
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.error).toMatch(/Requires role ADMIN/);
    expect((await testDb.request.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("OPEN");

    session.set(seed.admin);
    const ok = await resolveLeaveChange(c.data.requestId, true);
    expect(ok.ok && ok.data.status).toBe("APPROVED");
    const leave = await testDb.leave.findUniqueOrThrow({ where: { id: r.data.leaveId } });
    expect(leave.from.toISOString()).toBe("2026-09-22T00:00:00.000Z");
    expect(leave.to.toISOString()).toBe("2026-09-23T00:00:00.000Z");
    expect(leave.reason).toBe("Shifted a day");
    expect(leave.status).toBe("ADMIN_APPROVED");
    expect((await resolveLeaveChange(c.data.requestId, true)).ok).toBe(false); // already resolved

    // cancellation
    session.set(seed.exec);
    const cancel = await requestLeaveChange(r.data.leaveId, { cancel: true });
    if (!cancel.ok) throw new Error(cancel.error);
    session.set(seed.admin);
    expect((await resolveLeaveChange(cancel.data.requestId, true)).ok).toBe(true);
    const cancelled = await testDb.leave.findUniqueOrThrow({ where: { id: r.data.leaveId } });
    expect(cancelled.status).toBe("REJECTED");
    expect(cancelled.calendarEventId).toBeNull();
  });

  it("declining a change leaves the leave untouched", async () => {
    const { requestLeave, hrApprove, requestLeaveChange, resolveLeaveChange } = await import("@/server/leave/actions");
    const { myLeaves } = await import("@/server/leave/queries");
    session.set(seed.exec);
    const r = await requestLeave({ from: FROM, to: TO });
    if (!r.ok) throw new Error(r.error);
    session.set(seed.hr);
    await hrApprove(r.data.leaveId);
    session.set(seed.exec);
    const c = await requestLeaveChange(r.data.leaveId, { cancel: true });
    if (!c.ok) throw new Error(c.error);
    expect((await myLeaves(seed.exec.id))[0].pendingChange?.payload).toEqual({ cancel: true });
    session.set(seed.admin);
    expect((await resolveLeaveChange(c.data.requestId, false)).ok).toBe(true);
    const leave = await testDb.leave.findUniqueOrThrow({ where: { id: r.data.leaveId } });
    expect(leave.status).toBe("HR_APPROVED");
    expect((await myLeaves(seed.exec.id))[0].pendingChange).toBeNull();
  });
});
