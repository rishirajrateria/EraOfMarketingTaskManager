import { describe, expect, it, vi } from "vitest";
import type { TaskStatus } from "@prisma/client";
import { PendingCommits, UNDO_MS, circleTapAction } from "@/server/tasks/circle";

const ME = "me";
const t = (status: TaskStatus, assigneeIds: string[] = [ME]) => ({ status, assigneeIds });

describe("circleTapAction — a tap marks the task done from my side (ADR 0015)", () => {
  it("Admin completes directly from any open, unpaused state", () => {
    for (const s of ["DRAFT", "ASSIGNED", "STARTED", "FINISH_REQUESTED"] as TaskStatus[]) {
      expect(circleTapAction("ADMIN", t(s, ["someone"]), ME).kind, s).toBe("complete");
    }
  });

  it("Team Leader requests finish (Admin approves); a second tap while waiting does nothing", () => {
    expect(circleTapAction("TEAM_LEADER", t("ASSIGNED", ["exec"]), ME).kind).toBe("request_finish");
    expect(circleTapAction("TEAM_LEADER", t("STARTED", ["exec"]), ME).kind).toBe("request_finish");
    const waiting = circleTapAction("TEAM_LEADER", t("FINISH_REQUESTED"), ME);
    expect(waiting).toEqual({ kind: "none", message: expect.stringMatching(/waiting for Admin/) });
  });

  it("Executive: only on tasks assigned to them", () => {
    expect(circleTapAction("EXECUTIVE", t("STARTED"), ME).kind).toBe("request_finish");
    expect(circleTapAction("EXECUTIVE", t("ASSIGNED"), ME).kind).toBe("request_finish");
    expect(circleTapAction("EXECUTIVE", t("STARTED", ["other"]), ME)).toEqual({ kind: "none", message: expect.stringMatching(/assigned/) });
  });

  it("paused and completed tasks never change on a tap; HR / CA can't", () => {
    for (const role of ["ADMIN", "TEAM_LEADER", "EXECUTIVE"] as const) {
      expect(circleTapAction(role, t("PAUSED"), ME).kind).toBe("none");
      expect(circleTapAction(role, t("COMPLETED"), ME).kind).toBe("none");
    }
    expect(circleTapAction("HR", t("STARTED"), ME).kind).toBe("none");
    expect(circleTapAction("CA", t("STARTED"), ME).kind).toBe("none");
  });
});

describe("PendingCommits — Undo window", () => {
  it("commits after the window; Undo before it cancels", () => {
    vi.useFakeTimers();
    try {
      const c = new PendingCommits();
      const a = vi.fn();
      const b = vi.fn();
      c.schedule("a", a);
      const undoB = c.schedule("b", b);
      expect(c.keys().sort()).toEqual(["a", "b"]);
      vi.advanceTimersByTime(UNDO_MS - 1);
      expect(undoB()).toBe(true);
      expect(undoB()).toBe(false); // already undone
      vi.advanceTimersByTime(1);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).not.toHaveBeenCalled();
      expect(c.has("a")).toBe(false);
      vi.advanceTimersByTime(UNDO_MS * 2);
      expect(b).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-scheduling the same task replaces the earlier tap; flushAll sends everything now", () => {
    vi.useFakeTimers();
    try {
      const c = new PendingCommits();
      const first = vi.fn();
      const second = vi.fn();
      const other = vi.fn();
      c.schedule("x", first);
      c.schedule("x", second);
      c.schedule("y", other);
      c.flushAll();
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
      expect(other).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(UNDO_MS * 2);
      expect(second).toHaveBeenCalledTimes(1); // not twice
      expect(c.keys()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
