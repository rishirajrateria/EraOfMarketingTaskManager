import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { settle } from "./helpers";

const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
async function mkTask(extra: object = {}) {
  const t = await testDb.task.create({ data: { title: "Reel", clientId: seed.client.id, createdById: seed.admin.id, allocatedMinutes: 60, teams: { create: [{ teamId: seed.team.id }] }, assignees: { create: [{ userId: seed.exec.id }] }, ...extra } });
  return t.id;
}
const notes = (where: object) => testDb.notification.findMany({ where, orderBy: { createdAt: "asc" } });

describe("task notifications: who hears what (B4, B5, B6, doubts)", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    (await import("@/lib/settings")).invalidateSettingsCache();
    session.set(seed.admin); // createTaskAs runs as Admin
  });
  afterEach(() => session.clear());

  it("B4: protecting a task tells the requester their request was approved", async () => {
    const t = await testDb.task.create({ data: { title: "Mine", clientId: seed.client.id, createdById: seed.tl.id, selfAssigned: true, assignees: { create: [{ userId: seed.tl.id }] } } });
    await testDb.request.create({ data: { type: "FIX_SELF_TASK", taskId: t.id, raisedById: seed.tl.id, targetRole: "ADMIN" } });
    session.set(seed.admin);
    const { setTaskProtected } = await import("@/server/tasks/manage");
    expect((await setTaskProtected(t.id, true)).ok).toBe(true);
    const n = await notes({ userId: seed.tl.id });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ kind: "GENERIC", taskId: t.id });
    expect(n[0].title).toMatch(/approved/);
    expect(await testDb.notification.count({ where: { userId: seed.admin.id } })).toBe(0);
  });

  it("B5: Admin editing resolves open requests and tells each requester; a moved time sends TASK_SHIFTED", async () => {
    const start = new Date("2026-11-20T05:00:00Z");
    const id = await mkTask({ scheduledStart: start, scheduledEnd: new Date(start.getTime() + 3600_000) });
    await testDb.request.createMany({
      data: [
        { type: "TIME_CHANGE", taskId: id, raisedById: seed.exec.id, targetRole: "ADMIN", field: "time" },
        { type: "REVIEW", taskId: id, raisedById: seed.tl.id, targetRole: "ADMIN", field: "mins" },
      ],
    });
    await testDb.notification.deleteMany({});
    session.set(seed.admin);
    const { updateTask } = await import("@/server/tasks/manage");
    const next = new Date("2026-11-21T07:00:00Z");
    const res = await updateTask({ id, scheduledStart: next.toISOString(), scheduledEnd: new Date(next.getTime() + 3600_000).toISOString() });
    if (!res.ok) throw new Error(res.error);
    await settle();
    expect(await testDb.request.count({ where: { taskId: id, status: "OPEN" } })).toBe(0);
    const generic = await notes({ kind: "GENERIC" });
    expect(generic.find((n) => n.userId === seed.exec.id)?.title).toBe("Your time-change request was handled — task edited");
    expect(generic.find((n) => n.userId === seed.tl.id)?.title).toBe("Your review request was handled — task edited");
    const shifted = await notes({ kind: "TASK_SHIFTED" });
    expect(shifted.map((n) => n.userId).sort()).toEqual([seed.exec.id, seed.tl.id].sort());
    expect(shifted[0].title).toMatch(/^Moved to /);
    // an edit that doesn't touch the time sends no TASK_SHIFTED
    await testDb.notification.deleteMany({});
    expect((await updateTask({ id, title: "Renamed" })).ok).toBe(true);
    expect(await testDb.notification.count({ where: { kind: "TASK_SHIFTED" } })).toBe(0);
  });

  it("B6: you never hear about your own pause / resume / reject / unflag", async () => {
    const id = await mkTask();
    await testDb.task.update({ where: { id }, data: { createdById: seed.admin.id } });
    session.set(seed.admin);
    const L = await import("@/server/tasks/lifecycle");
    expect((await L.startTask(id)).ok).toBe(true);
    await testDb.notification.deleteMany({});
    expect((await L.pauseTask(id)).ok).toBe(true);
    expect((await L.resumeTask(id)).ok).toBe(true);
    const mine = await testDb.notification.count({ where: { userId: seed.admin.id } });
    expect(mine).toBe(0);
    const theirs = await notes({ userId: seed.exec.id });
    expect(theirs.map((n) => n.kind)).toEqual(["TASK_PAUSED", "TASK_RESUMED"]);

    await testDb.task.update({ where: { id }, data: { doubtRaised: true, doubtNote: "?" } });
    await testDb.request.create({ data: { type: "DOUBT", taskId: id, raisedById: seed.tl.id, targetRole: "ADMIN" } });
    await testDb.notification.deleteMany({});
    expect((await L.resolveDoubt(id, "ok")).ok).toBe(true);
    expect(await testDb.notification.count({ where: { userId: seed.admin.id } })).toBe(0);
    expect(await testDb.notification.count({ where: { userId: seed.tl.id, kind: "DOUBT_RESOLVED" } })).toBe(1);
  });

  it("B6: notify() and taskStakeholderIds drop the acting user", async () => {
    const { notify, taskStakeholderIds } = await import("@/lib/notify");
    const rows = await notify({ userIds: [seed.admin.id, seed.hr.id], exceptUserId: seed.admin.id, kind: "GENERIC", title: "x" });
    expect(rows.map((r) => r.userId)).toEqual([seed.hr.id]);
    const id = await mkTask();
    expect(await taskStakeholderIds(id, { exceptUserId: seed.exec.id })).not.toContain(seed.exec.id);
  });

  it("INVOICE_SENT does not go to the admin who sent it", async () => {
    const inv = await testDb.invoice.create({ data: { number: "DRAFT-2", clientId: seed.client.id, status: "AWAITING_APPROVAL", subtotal: 100, gstAmount: 18, total: 118 } as never });
    const other = await testDb.user.create({ data: { email: "a2@test.local", name: "Other Admin", role: "ADMIN", activatedAt: new Date() } });
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "c@test.local" } });
    session.set(seed.admin);
    const { approveAndSendCore } = await import("@/server/finance/approve-core");
    await approveAndSendCore(inv.id, { email: true, whatsapp: false, emailText: null, whatsappText: null }, seed.admin.id);
    const sent = await notes({ kind: "INVOICE_SENT" });
    expect(sent.map((n) => n.userId)).not.toContain(seed.admin.id);
    expect(sent.map((n) => n.userId)).toEqual([other.id]);
  });

  it("a second doubt on a task with an open doubt is refused: one request, one notification", async () => {
    const id = await mkTask();
    session.set(seed.tl);
    const { raiseDoubt } = await import("@/server/tasks/lifecycle");
    expect((await raiseDoubt(id, "first")).ok).toBe(true);
    const again = await raiseDoubt(id, "second");
    expect(again.ok).toBe(false);
    expect(!again.ok && again.error).toMatch(/already open/);
    expect(await testDb.request.count({ where: { taskId: id, type: "DOUBT", status: "OPEN" } })).toBe(1);
    expect(await testDb.notification.count({ where: { kind: "DOUBT_RAISED" } })).toBe(1);
  });
});
