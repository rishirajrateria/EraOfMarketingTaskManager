import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();
type Seed = Awaited<ReturnType<typeof seedBasics>>;
const FROM = "2026-09-21";
const TO = "2026-09-22";
const A = () => import("@/server/leave/actions");

describe("leave: self-approval and change requests (B7)", () => {
  let seed: Seed;
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T05:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    session.clear();
  });
  afterAll(() => testDb.$disconnect());

  it("HR's own leave goes to Admin only; HR cannot decide it, Admin can", async () => {
    const { requestLeave, hrApprove, hrReject } = await A();
    const { leaveInbox } = await import("@/server/leave/queries");
    session.set(seed.hr);
    const r = await requestLeave({ from: FROM, to: TO, reason: "Trip" });
    if (!r.ok) throw new Error(r.error);
    expect(await testDb.request.findFirstOrThrow({ where: { leaveId: r.data.leaveId } })).toMatchObject({ targetRole: "ADMIN", status: "OPEN" });
    expect((await testDb.notification.findMany({ where: { kind: "LEAVE_REQUESTED" } })).map((n) => n.userId)).toEqual([seed.admin.id]);
    const own = await hrApprove(r.data.leaveId);
    expect(!own.ok && own.error).toBe("Someone else must approve your leave");
    expect((await hrReject(r.data.leaveId, "no")).ok).toBe(false);
    expect((await leaveInbox(seed.hr)).pending).toHaveLength(0); // not even listed for HR
    session.set(seed.admin);
    expect((await leaveInbox(seed.admin)).pending).toHaveLength(1);
    expect((await hrApprove(r.data.leaveId)).ok).toBe(true);
    expect((await testDb.leave.findUniqueOrThrow({ where: { id: r.data.leaveId } })).status).toBe("ADMIN_APPROVED");
  });

  it("another HR person cannot decide an HR person's leave", async () => {
    const hr2 = await testDb.user.create({ data: { email: "hr2@test.local", name: "HR Two", role: "HR", activatedAt: new Date() } });
    const { requestLeave, hrApprove } = await A();
    session.set(seed.hr);
    const r = await requestLeave({ from: FROM, to: TO });
    if (!r.ok) throw new Error(r.error);
    session.set(hr2);
    expect((await hrApprove(r.data.leaveId)).ok).toBe(false);
  });

  it("Admin's own leave is approved on submit, audited, and HR is told", async () => {
    const { requestLeave, hrApprove } = await A();
    session.set(seed.admin);
    const r = await requestLeave({ from: FROM, to: TO, reason: "Holiday" });
    if (!r.ok) throw new Error(r.error);
    const leave = await testDb.leave.findUniqueOrThrow({ where: { id: r.data.leaveId } });
    expect(leave).toMatchObject({ status: "ADMIN_APPROVED", adminApprovedById: seed.admin.id });
    expect(leave.calendarEventId).toMatch(/^evt_/);
    expect(await testDb.request.count({ where: { leaveId: leave.id, status: "OPEN" } })).toBe(0);
    expect(await testDb.auditLog.count({ where: { action: "leave.autoApprove", entityId: leave.id } })).toBe(1);
    const told = await testDb.notification.findMany({});
    expect(told.map((n) => n.userId)).toEqual([seed.hr.id]);
    expect(told[0].title).toMatch(/is on leave 21–22 Sep/);
    expect((await hrApprove(leave.id)).ok).toBe(false); // already decided
  });

  it("an executive's leave can't be approved by the executive; the decision-maker is someone else", async () => {
    const { requestLeave, hrApprove, hrReject } = await A();
    session.set(seed.exec);
    const r = await requestLeave({ from: FROM, to: TO });
    if (!r.ok) throw new Error(r.error);
    expect((await hrApprove(r.data.leaveId)).ok).toBe(false); // not HR/Admin at all
    expect((await hrReject(r.data.leaveId)).ok).toBe(false);
  });

  it("HR-raised change: titled with HR's name; outcome quotes the NEW dates and reaches owner and requester; cancel reads Cancelled", async () => {
    const { requestLeave, hrApprove, requestLeaveChange, resolveLeaveChange } = await A();
    const { myLeaves } = await import("@/server/leave/queries");
    session.set(seed.exec);
    const r = await requestLeave({ from: FROM, to: TO });
    if (!r.ok) throw new Error(r.error);
    session.set(seed.hr);
    await hrApprove(r.data.leaveId);
    await testDb.notification.deleteMany({});
    const c = await requestLeaveChange(r.data.leaveId, { from: "2026-09-24", to: "2026-09-25", reason: "Moved" });
    if (!c.ok) throw new Error(c.error);
    const asked = await testDb.notification.findMany({ where: { kind: "LEAVE_REQUESTED" } });
    expect(asked.map((n) => n.userId)).toEqual([seed.admin.id]); // HR + Admins, minus the actor
    expect(asked[0].title).toBe("HR asked to change Arush's leave on 21–22 Sep");

    session.set(seed.admin);
    await testDb.notification.deleteMany({});
    expect((await resolveLeaveChange(c.data.requestId, true)).ok).toBe(true);
    const out = await testDb.notification.findMany({ where: { kind: "LEAVE_APPROVED" } });
    const byUser = Object.fromEntries(out.map((n) => [n.userId, n.title]));
    expect(byUser[seed.exec.id]).toBe("Your leave change on 24–25 Sep was approved");
    expect(byUser[seed.hr.id]).toBe("Arush's leave change on 24–25 Sep was approved");
    expect(byUser[seed.admin.id]).toBeUndefined();

    // cancellation approved → "Cancelled", not a plain rejection
    session.set(seed.hr);
    const x = await requestLeaveChange(r.data.leaveId, { cancel: true });
    if (!x.ok) throw new Error(x.error);
    session.set(seed.admin);
    expect((await resolveLeaveChange(x.data.requestId, true)).ok).toBe(true);
    const mine = (await myLeaves(seed.exec.id))[0];
    expect(mine).toMatchObject({ status: "REJECTED", cancelled: true });
  });

  it("a declined change quotes the dates that were asked for; a plain rejection is not 'cancelled'", async () => {
    const { requestLeave, hrApprove, hrReject, requestLeaveChange, resolveLeaveChange } = await A();
    const { myLeaves } = await import("@/server/leave/queries");
    session.set(seed.exec);
    const a = await requestLeave({ from: FROM, to: TO });
    const b = await requestLeave({ from: "2026-10-05", to: "2026-10-05" });
    if (!a.ok || !b.ok) throw new Error("setup");
    session.set(seed.hr);
    await hrApprove(a.data.leaveId);
    await hrReject(b.data.leaveId, "busy");
    expect((await myLeaves(seed.exec.id)).map((l) => l.cancelled)).toEqual([false, false]);
    const c = await requestLeaveChange(a.data.leaveId, { from: "2026-09-28", to: "2026-09-29" });
    if (!c.ok) throw new Error(c.error);
    await testDb.notification.deleteMany({});
    session.set(seed.admin);
    await resolveLeaveChange(c.data.requestId, false);
    const n = await testDb.notification.findFirstOrThrow({ where: { userId: seed.exec.id, kind: "LEAVE_REJECTED" } });
    expect(n.title).toBe("Your leave change on 28–29 Sep was declined");
  });

  it("Admin's own change to their own leave applies at once; nobody may resolve their own", async () => {
    const { requestLeave, requestLeaveChange, resolveLeaveChange } = await A();
    session.set(seed.admin);
    const r = await requestLeave({ from: FROM, to: TO });
    if (!r.ok) throw new Error(r.error);
    const c = await requestLeaveChange(r.data.leaveId, { from: "2026-09-23", to: "2026-09-24" });
    expect(c.ok).toBe(true);
    const leave = await testDb.leave.findUniqueOrThrow({ where: { id: r.data.leaveId } });
    expect(leave.from.toISOString()).toBe("2026-09-23T00:00:00.000Z");
    // an open change request on an admin's own leave raised by someone else can't be resolved by that admin
    const req = await testDb.request.create({ data: { type: "APPROVED_CHANGE", leaveId: leave.id, raisedById: seed.hr.id, targetRole: "ADMIN", payload: { cancel: true } } });
    const self = await resolveLeaveChange(req.id, true);
    expect(!self.ok && self.error).toBe("Someone else must approve your leave");
  });
});
