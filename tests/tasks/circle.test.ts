import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { createTaskAs, loadTask, settle } from "./helpers";

const session = mockSession();

describe("completeFromMySide — the card's completion circle (ADR 0015)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("Admin: one tap completes the task, even before it was started; Meet stays active", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id]);
    const { processPending } = await import("@/google/queue");
    await settle(100);
    await processPending();
    const { completeFromMySide } = await import("@/server/tasks/lifecycle");
    const res = await completeFromMySide(id);
    expect(res).toEqual({ ok: true, data: { kind: "complete" } });
    const t = await loadTask(id);
    expect(t.status).toBe("COMPLETED");
    expect(t.actualEnd).not.toBeNull();
    expect(t.meetActive).toBe(true);
    expect((await completeFromMySide(id)).ok).toBe(false); // already completed
  });

  it("Team Leader: marks their side done → FINISH_REQUESTED + a request for Admin", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id]);
    session.set(tl);
    const { completeFromMySide } = await import("@/server/tasks/lifecycle");
    expect(await completeFromMySide(id)).toEqual({ ok: true, data: { kind: "request_finish" } });
    const t = await loadTask(id);
    expect(t.status).toBe("FINISH_REQUESTED");
    expect(t.finishRequestedById).toBe(tl.id);
    expect(t.requests.filter((r) => r.type === "FINISH" && r.status === "OPEN")).toHaveLength(1);
    expect(await testDb.notification.count({ where: { taskId: id, kind: "FINISH_REQUESTED", userId: admin.id } })).toBe(1);
    const again = await completeFromMySide(id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/waiting for Admin/);
  });

  it("Executive: own task only; paused tasks don't change", async () => {
    const { admin, tl, exec, client } = await seedBasics();
    session.set(tl);
    const own = await createTaskAs(client.id, [exec.id]);
    const notMine = await createTaskAs(client.id, [tl.id]);
    const { completeFromMySide, pauseTask } = await import("@/server/tasks/lifecycle");
    session.set(exec);
    const denied = await completeFromMySide(notMine);
    expect(denied.ok).toBe(false);
    expect((await loadTask(notMine)).status).toBe("ASSIGNED");

    session.set(admin);
    expect((await pauseTask(own)).ok).toBe(true);
    session.set(exec);
    const paused = await completeFromMySide(own);
    expect(paused.ok).toBe(false);
    if (!paused.ok) expect(paused.error).toMatch(/paused/);

    session.set(admin);
    const { resumeTask } = await import("@/server/tasks/lifecycle");
    await resumeTask(own);
    session.set(exec);
    expect(await completeFromMySide(own)).toEqual({ ok: true, data: { kind: "request_finish" } });
    expect((await loadTask(own)).status).toBe("FINISH_REQUESTED");
  });
});
