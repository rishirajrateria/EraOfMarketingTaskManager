import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { createTaskAs, loadTask, settle } from "./helpers";

const session = mockSession();
const H = 3_600_000;

async function pastTask(clientId: string, assigneeIds: string[], title = "late") {
  return createTaskAs(clientId, assigneeIds, {
    title,
    scheduledStart: new Date(Date.now() - 2 * H).toISOString(),
    scheduledEnd: new Date(Date.now() - 1 * H).toISOString(),
  });
}

describe("jobs/overdue", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150); // let createTask's fire-and-forget queue drain before the next resetDb()
  });

  it("flags a task whose scheduledStart passed without a start, and notifies stakeholders once", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await pastTask(client.id, [tl.id]);
    const { run } = await import("@/jobs/overdue");
    const r1 = await run();
    expect(r1.flagged).toBe(1);
    expect(r1.cleared).toBe(0);
    const t = await loadTask(id);
    expect(t.overdue).toBe(true);
    expect(t.overdueNotifiedAt).not.toBeNull();
    expect(t.status).toBe("ASSIGNED"); // status unchanged, colour overlay only
    const notes = await testDb.notification.findMany({ where: { taskId: id, kind: "TASK_OVERDUE" } });
    expect(notes.map((n) => n.userId).sort()).toEqual([admin.id, tl.id].sort());

    // idempotent: a second run neither re-flags nor re-notifies
    const r2 = await run();
    expect(r2.flagged).toBe(0);
    expect(await testDb.notification.count({ where: { taskId: id, kind: "TASK_OVERDUE" } })).toBe(2);
  });

  it("does not flag future tasks or meetings", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const future = await createTaskAs(client.id, [tl.id], { title: "future", scheduledStart: new Date(Date.now() + 2 * H).toISOString() });
    const meeting = await createTaskAs(client.id, [tl.id], {
      title: "old meeting",
      type: "MEETING",
      scheduledStart: new Date(Date.now() - 2 * H).toISOString(),
      scheduledEnd: new Date(Date.now() - 1 * H).toISOString(),
    });
    const { run } = await import("@/jobs/overdue");
    const r = await run();
    expect(r.flagged).toBe(0);
    expect((await loadTask(future)).overdue).toBe(false);
    expect((await loadTask(meeting)).overdue).toBe(false);
  });

  it("clears the flag once the task is started and its scheduledEnd is in the future", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await pastTask(client.id, [tl.id]);
    const { run } = await import("@/jobs/overdue");
    await run();
    expect((await loadTask(id)).overdue).toBe(true);

    session.set(tl);
    const { startTask } = await import("@/server/tasks/lifecycle");
    expect((await startTask(id)).ok).toBe(true);
    // starting clears the overlay immediately; end is still in the past, so the job would re-flag it
    const r1 = await run();
    expect(r1.flagged).toBe(1);
    expect((await loadTask(id)).overdue).toBe(true);

    await testDb.task.update({ where: { id }, data: { scheduledEnd: new Date(Date.now() + 2 * H) } });
    const r2 = await run();
    expect(r2.cleared).toBe(1);
    expect(r2.flagged).toBe(0);
    const t = await loadTask(id);
    expect(t.overdue).toBe(false);
    expect(t.status).toBe("STARTED");
  });

  it("flags a started task once scheduledEnd has passed", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id], { title: "running", scheduledStart: new Date(Date.now() + 1 * H).toISOString() });
    session.set(tl);
    const { startTask } = await import("@/server/tasks/lifecycle");
    await startTask(id);
    const { run } = await import("@/jobs/overdue");
    expect((await run()).flagged).toBe(0);
    await testDb.task.update({ where: { id }, data: { scheduledEnd: new Date(Date.now() - 60_000) } });
    expect((await run()).flagged).toBe(1);
    expect((await loadTask(id)).overdue).toBe(true);
  });

  it("a PAUSED task is never flagged, and an existing flag is cleared while paused", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await pastTask(client.id, [tl.id]);
    const lc = await import("@/server/tasks/lifecycle");
    session.set(tl);
    await lc.startTask(id);
    session.set(admin);
    await lc.pauseTask(id);
    const { run } = await import("@/jobs/overdue");
    const r = await run();
    expect(r.flagged).toBe(0);
    let t = await loadTask(id);
    expect(t.status).toBe("PAUSED");
    expect(t.overdue).toBe(false);
    expect(await testDb.notification.count({ where: { taskId: id, kind: "TASK_OVERDUE" } })).toBe(0);

    // a stale flag on a paused task is cleared by the job
    await testDb.task.update({ where: { id }, data: { overdue: true } });
    expect((await run()).cleared).toBe(1);
    t = await loadTask(id);
    expect(t.overdue).toBe(false);
  });

  it("ignores soft-deleted and completed tasks", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const deleted = await pastTask(client.id, [tl.id], "deleted");
    const completed = await pastTask(client.id, [tl.id], "completed");
    await testDb.task.update({ where: { id: deleted }, data: { deletedAt: new Date() } });
    await testDb.task.update({ where: { id: completed }, data: { status: "COMPLETED" } });
    const { run } = await import("@/jobs/overdue");
    expect((await run()).flagged).toBe(0);
    expect((await loadTask(deleted)).overdue).toBe(false);
    expect((await loadTask(completed)).overdue).toBe(false);
  });
});
