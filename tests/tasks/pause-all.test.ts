import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { createTaskAs, loadTask, settle } from "./helpers";
import { pauseAllSplit } from "@/components/dashboard/PauseAllSheet";

const session = mockSession();

describe("Admin Pause all / Resume all (ADR 0015)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("pauseAllSplit: open tasks to pause vs paused ones to resume; completed ignored", () => {
    const rows = [
      { id: "a", status: "ASSIGNED" as const },
      { id: "s", status: "STARTED" as const },
      { id: "f", status: "FINISH_REQUESTED" as const },
      { id: "p", status: "PAUSED" as const },
      { id: "c", status: "COMPLETED" as const },
    ];
    expect(pauseAllSplit(rows)).toEqual({ toPause: ["a", "s", "f"], toResume: ["p"] });
  });

  it("pauses every listed task in one go (sessions closed, assignees notified with the reason), then resumes them", async () => {
    const { admin, tl, exec, client } = await seedBasics();
    session.set(admin);
    const a = await createTaskAs(client.id, [tl.id], { title: "A" });
    session.set(tl);
    const b = await createTaskAs(client.id, [exec.id], { title: "B" });
    const lc = await import("@/server/tasks/lifecycle");
    await lc.startTask(b);
    const { pauseResumeMany } = await import("@/server/tasks/bulk");

    // Admin only
    expect((await pauseResumeMany({ taskIds: [a, b], action: "PAUSE" })).ok).toBe(false);

    session.set(admin);
    const res = await pauseResumeMany({ taskIds: [a, b, a], action: "PAUSE", reason: "Office closed for Diwali" });
    expect(res).toEqual({ ok: true, data: { changed: 2, skipped: 0 } });
    const [ta, tb] = [await loadTask(a), await loadTask(b)];
    expect([ta.status, tb.status]).toEqual(["PAUSED", "PAUSED"]);
    expect(tb.statusBeforePause).toBe("STARTED");
    expect(tb.sessions.every((s) => s.endedAt !== null)).toBe(true);
    const note = await testDb.notification.findFirstOrThrow({ where: { taskId: b, kind: "TASK_PAUSED", userId: exec.id } });
    expect(note.body).toBe("Office closed for Diwali");
    expect(await testDb.auditLog.count({ where: { action: "task.pause_all" } })).toBe(2);

    // pausing again: nothing eligible
    expect(await pauseResumeMany({ taskIds: [a, b], action: "PAUSE" })).toEqual({ ok: true, data: { changed: 0, skipped: 2 } });

    const back = await pauseResumeMany({ taskIds: [a, b], action: "RESUME" });
    expect(back).toEqual({ ok: true, data: { changed: 2, skipped: 0 } });
    expect((await loadTask(a)).status).toBe("ASSIGNED");
    const rb = await loadTask(b);
    expect(rb.status).toBe("STARTED");
    expect(rb.sessions.filter((s) => s.endedAt === null)).toHaveLength(1);
  });

  it("refuses unknown / deleted ids and bad input", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const a = await createTaskAs(client.id, [tl.id]);
    const { pauseResumeMany } = await import("@/server/tasks/bulk");
    expect((await pauseResumeMany({ taskIds: [a, "nope"], action: "PAUSE" })).ok).toBe(false);
    expect((await pauseResumeMany({ taskIds: [], action: "PAUSE" })).ok).toBe(false);
    expect((await pauseResumeMany({ taskIds: [a], action: "STOP" as "PAUSE" })).ok).toBe(false);
    expect((await loadTask(a)).status).toBe("ASSIGNED");
  });
});
