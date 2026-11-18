/**
 * The completion circle on a task card works like Google Tasks (ADR 0015): one tap marks the task done "from my side".
 * Pure and client-safe — the dashboard uses it to decide what a tap does, and the server action re-checks with it.
 *
 * - Admin: completes the task directly (APPROVE_FINISH, also from ASSIGNED / STARTED).
 * - Team Leader: their side is done → REQUEST_FINISH; Admin approves as before.
 * - Executive: the same, but only on tasks assigned to them.
 * Paused, completed and already-requested tasks don't change on a tap; the message says why.
 */
import type { TaskStatus } from "@prisma/client";

export type CircleRole = "ADMIN" | "TEAM_LEADER" | "EXECUTIVE" | "HR" | "CA";

export type CircleAction =
  | { kind: "complete"; toast: string }
  | { kind: "request_finish"; toast: string }
  | { kind: "none"; message: string };

export function circleTapAction(role: CircleRole, t: { status: TaskStatus; assigneeIds: string[] }, meId: string): CircleAction {
  if (t.status === "COMPLETED") return { kind: "none", message: "Already completed" };
  if (t.status === "PAUSED") return { kind: "none", message: role === "ADMIN" ? "Resume the task first (long-press for actions)" : "Task is paused by Admin" };
  if (role === "ADMIN") return { kind: "complete", toast: "Task completed" };
  if (role !== "TEAM_LEADER" && role !== "EXECUTIVE") return { kind: "none", message: "Only the task's people can mark it done" };
  if (role === "EXECUTIVE" && !t.assigneeIds.includes(meId)) return { kind: "none", message: "Only the assigned people can mark this done" };
  if (t.status === "FINISH_REQUESTED") return { kind: "none", message: "Done from your side · waiting for Admin approval" };
  return { kind: "request_finish", toast: "Done from your side · Admin will approve" };
}

/** How long the Undo toast keeps a tap uncommitted. */
export const UNDO_MS = 5000;

/**
 * Deferred commits with Undo (pure, timer-injected for tests): a tap is scheduled and only sent to the server when
 * the Undo window closes; Undo cancels it; `flushAll` sends everything pending right away (page hide / unload).
 */
export class PendingCommits {
  private pending = new Map<string, { timer: unknown; run: () => void }>();

  constructor(
    private readonly timers: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void } = {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    },
  ) {}

  /** Schedules `run` for `key` (replacing an earlier one for the same key). Returns the undo function. */
  schedule(key: string, run: () => void, ms = UNDO_MS): () => boolean {
    this.cancel(key);
    const timer = this.timers.set(() => {
      this.pending.delete(key);
      run();
    }, ms);
    this.pending.set(key, { timer, run });
    return () => this.cancel(key);
  }

  /** Undo: true when something was still pending. */
  cancel(key: string): boolean {
    const p = this.pending.get(key);
    if (!p) return false;
    this.timers.clear(p.timer);
    this.pending.delete(key);
    return true;
  }

  has(key: string): boolean {
    return this.pending.has(key);
  }

  keys(): string[] {
    return [...this.pending.keys()];
  }

  flushAll(): void {
    for (const [key, p] of [...this.pending]) {
      this.timers.clear(p.timer);
      this.pending.delete(key);
      p.run();
    }
  }
}
