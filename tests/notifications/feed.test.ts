import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { createTaskAs, settle } from "../tasks/helpers";

const session = mockSession();
const H = 3_600_000;
const TZ = "Asia/Kolkata";

describe("notifications feed (ADR 0017)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("start: late vs on time, to Admin + the team's TL, never to the one who started it", async () => {
    const { admin, tl, exec, client } = await seedBasics();
    session.set(tl);
    const late = await createTaskAs(client.id, [exec.id], { title: "late one", scheduledStart: new Date(Date.now() - 2 * H).toISOString() });
    const early = await createTaskAs(client.id, [exec.id], { title: "early one", scheduledStart: new Date(Date.now() + 2 * H).toISOString() });
    const { startTask } = await import("@/server/tasks/lifecycle");
    session.set(admin);
    expect((await startTask(late)).ok).toBe(true);
    session.set(tl);
    expect((await startTask(early)).ok).toBe(true);

    const lateNotes = await testDb.notification.findMany({ where: { taskId: late, kind: { in: ["TASK_STARTED", "TASK_STARTED_LATE"] } } });
    expect(lateNotes.map((n) => [n.userId, n.kind])).toEqual([[tl.id, "TASK_STARTED_LATE"]]); // Admin started it
    expect(lateNotes[0].title).toMatch(/^Admin started it (1|2) h( \d+ min)? late$/);
    const earlyNotes = await testDb.notification.findMany({ where: { taskId: early, kind: { in: ["TASK_STARTED", "TASK_STARTED_LATE"] } } });
    expect(earlyNotes.map((n) => [n.userId, n.kind, n.title])).toEqual([[admin.id, "TASK_STARTED", "Rishi started it on time"]]);
    expect(await testDb.notification.count({ where: { userId: exec.id, kind: { in: ["TASK_STARTED", "TASK_STARTED_LATE"] } } })).toBe(0);
  });

  it("completed late: assignees + TL hear 'Completed · n min late'; done from their side reaches Admin", async () => {
    const { admin, tl, exec, client } = await seedBasics();
    session.set(tl);
    const id = await createTaskAs(client.id, [exec.id], { title: "report", scheduledStart: new Date(Date.now() - 2 * H).toISOString() });
    await testDb.task.update({ where: { id }, data: { scheduledEnd: new Date(Date.now() - 30 * 60_000) } });
    const lc = await import("@/server/tasks/lifecycle");
    session.set(exec);
    expect((await lc.requestFinish(id)).ok).toBe(true);
    const asked = await testDb.notification.findFirstOrThrow({ where: { taskId: id, kind: "FINISH_REQUESTED" } });
    expect(asked).toMatchObject({ userId: admin.id, title: "Arush marked it done from their side", href: `/dashboard?task=${id}` });
    session.set(admin);
    expect((await lc.approveFinish(id)).ok).toBe(true);
    const done = await testDb.notification.findMany({ where: { taskId: id, kind: "TASK_COMPLETED" } });
    expect(done.map((n) => n.userId).sort()).toEqual([exec.id, tl.id].sort());
    expect(done[0].title).toMatch(/^Completed · (29|30) min late$/); // their "done" time counts, not Admin's approval
    expect(await testDb.notification.count({ where: { kind: "FINISH_APPROVED" } })).toBe(0);
  });

  it("bills due and invoices to approve never become feed rows (reminder only)", async () => {
    const { admin } = await seedBasics();
    const { notify, remind, reminderLog } = await import("@/lib/notify");
    expect(await notify({ userIds: [admin.id], kind: "PAYMENT_DUE", title: "Payment due tomorrow: Rent" })).toEqual([]);
    await remind({ userIds: [admin.id], kind: "INVOICE_APPROVAL_DUE", title: "Approve invoice" });
    expect(await testDb.notification.count()).toBe(0);
    expect(reminderLog.map((r) => r.kind)).toEqual(["PAYMENT_DUE", "INVOICE_APPROVAL_DUE"]);
    // legacy rows of those kinds are neither listed nor counted
    await testDb.notification.create({ data: { userId: admin.id, kind: "PAYMENT_DUE", title: "old bill" } });
    const { loadFeed, unreadNotificationCount } = await import("@/server/notification-feed");
    expect(await unreadNotificationCount(admin.id)).toBe(0);
    expect((await loadFeed(admin, "ALL", TZ)).total).toBe(0);
  });

  it("feed: task rows show the task title + phrase + kind · client · team · time; filters; grouping; mark read", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const taskId = await createTaskAs(client.id, [tl.id], { title: "Instagram carousel" });
    await testDb.notification.deleteMany();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 26 * H);
    const mk = (kind: string, title: string, extra: Record<string, unknown> = {}) =>
      testDb.notification.create({ data: { userId: admin.id, kind: kind as never, title, ...extra } });
    const started = await mk("TASK_STARTED_LATE", "Rishi started it 5 min late", { taskId, href: `/dashboard?task=${taskId}` });
    await mk("LEAVE_APPROVED", "Arush's leave on 17 Oct was approved · no tasks affected", { href: "/requests/leave?leaveId=x", createdAt: yesterday });
    await mk("TDS_THRESHOLD", "TDS threshold crossed for Skyline", { readAt: now, createdAt: yesterday });
    const { loadFeed } = await import("@/server/notification-feed");

    const all = await loadFeed(admin, "ALL", TZ, now);
    expect(all.unread).toBe(2);
    expect(all.groups.map((g) => [g.label, g.rows.length])).toEqual([["Today", 1], ["Yesterday", 2]]);
    const row = all.groups[0].rows[0];
    expect(row).toMatchObject({ id: started.id, tone: "red", icon: "play", headline: "Instagram carousel", phrase: "Rishi started it 5 min late", read: false, target: `/dashboard?task=${taskId}` });
    expect(row.meta).toMatch(/^Started late · Repo · Graphic · \d{1,2}:\d{2}(am|pm)$/);
    const leave = all.groups[1].rows.find((r) => r.kind === "LEAVE_APPROVED");
    expect(leave).toMatchObject({ tone: "amber", headline: "Arush's leave on 17 Oct was approved · no tasks affected", phrase: null, target: "/admin/requests?tab=HR" });

    const count = async (f: "UNREAD" | "TASKS" | "PEOPLE" | "MONEY") => (await loadFeed(admin, f, TZ, now)).total;
    expect([await count("UNREAD"), await count("TASKS"), await count("PEOPLE"), await count("MONEY")]).toEqual([2, 1, 1, 1]);

    const { markRead, markAllRead } = await import("@/server/notifications");
    session.set(tl);
    await markRead(started.id); // someone else's row: untouched
    expect((await testDb.notification.findUniqueOrThrow({ where: { id: started.id } })).readAt).toBeNull();
    session.set(admin);
    expect((await markRead(started.id)).ok).toBe(true);
    expect((await loadFeed(admin, "ALL", TZ, now)).unread).toBe(1);
    expect((await markAllRead()).ok).toBe(true);
    expect((await loadFeed(admin, "UNREAD", TZ, now)).total).toBe(0);
  });
});
