/**
 * Pure task state machine + row colour derivation (SPEC §5.2, §7). No DB access.
 */
import type { TaskStatus } from "@prisma/client";

export type RowColour = "white" | "green" | "yellow" | "red" | "grey";

export type ColourInput = {
  status: TaskStatus;
  overdue: boolean;
  doubtRaised: boolean;
  type?: "WORK" | "MEETING";
};

/** Precedence: grey (completed) > yellow (doubt) > red (overdue) > green (started) > white. */
export function rowColour(t: ColourInput): RowColour {
  if (t.status === "COMPLETED") return "grey";
  if (t.doubtRaised) return "yellow";
  if (t.overdue) return "red";
  if (t.status === "STARTED" || t.status === "FINISH_REQUESTED") return "green";
  if (t.status === "PAUSED") return "green";
  return "white";
}

export type Transition =
  | "START"
  | "PAUSE"
  | "RESUME"
  | "REQUEST_FINISH"
  | "APPROVE_FINISH"
  | "REJECT_FINISH"
  | "RESTART";

const TABLE: Record<Transition, { from: TaskStatus[]; to: TaskStatus | null }> = {
  START: { from: ["ASSIGNED", "DRAFT"], to: "STARTED" },
  PAUSE: { from: ["ASSIGNED", "STARTED", "FINISH_REQUESTED"], to: "PAUSED" },
  RESUME: { from: ["PAUSED"], to: null }, // returns to statusBeforePause
  REQUEST_FINISH: { from: ["STARTED"], to: "FINISH_REQUESTED" },
  APPROVE_FINISH: { from: ["FINISH_REQUESTED", "STARTED"], to: "COMPLETED" },
  REJECT_FINISH: { from: ["FINISH_REQUESTED"], to: "STARTED" },
  RESTART: { from: ["COMPLETED"], to: null }, // creates a duplicate
};

export function canTransition(status: TaskStatus, t: Transition): boolean {
  return TABLE[t].from.includes(status);
}

export function nextStatus(status: TaskStatus, t: Transition, statusBeforePause?: TaskStatus | null): TaskStatus {
  if (!canTransition(status, t)) throw new Error(`Cannot ${t} a task in state ${status}`);
  if (t === "RESUME") return statusBeforePause ?? "STARTED";
  if (t === "RESTART") return "ASSIGNED";
  return TABLE[t].to!;
}

/** Overdue evaluation (SPEC §7): scheduled start missed without starting, or end missed without finish. */
export function isOverdue(
  t: { status: TaskStatus; scheduledStart: Date | null; scheduledEnd: Date | null; actualStart: Date | null; type?: "WORK" | "MEETING" },
  now: Date,
): boolean {
  if (t.type === "MEETING") return false;
  if (t.status === "COMPLETED" || t.status === "PAUSED") return false;
  if (t.scheduledStart && !t.actualStart && now > t.scheduledStart && (t.status === "ASSIGNED" || t.status === "DRAFT")) return true;
  if (t.scheduledEnd && now > t.scheduledEnd) return true;
  return false;
}

/** Actual worked minutes from sessions, excluding pauses. */
export function workedMinutes(sessions: { startedAt: Date; endedAt: Date | null }[], now = new Date()): number {
  return sessions.reduce((sum, s) => sum + Math.max(0, ((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 60000), 0);
}

export const ACTIVE_STATUSES: TaskStatus[] = ["DRAFT", "ASSIGNED", "STARTED", "PAUSED", "FINISH_REQUESTED"];
