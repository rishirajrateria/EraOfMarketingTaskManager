/**
 * Pure task state machine + row colour derivation (SPEC §5.2, §7). No DB access.
 */
import type { TaskStatus } from "@prisma/client";

export type RowColour = "white" | "green" | "yellow" | "red" | "grey" | "purple";

export type ColourInput = {
  status: TaskStatus;
  /** Doubt raised → the whole card is purple (with the "?" badge, ADR 0015). */
  doubtRaised?: boolean;
  overdue?: boolean;
  type?: "WORK" | "MEETING";
  scheduledStart?: Date | string | null;
};

/**
 * Row colour (owner's definitions, ADR 0015). Precedence:
 * completed → "grey" (rendered as a faded card, not a fill) > doubt raised → purple > PAUSED → yellow > started
 * (STARTED / FINISH_REQUESTED) → green > not started and the scheduled start has passed → red (work tasks; meetings
 * aren't started) > white.
 * A started task that runs past its end stays green — its time pill turns red instead (`actualTone`).
 */
export function rowColour(t: ColourInput, now: Date = new Date()): RowColour {
  if (t.status === "COMPLETED") return "grey";
  if (t.doubtRaised) return "purple";
  if (t.status === "PAUSED") return "yellow";
  if (t.status === "STARTED" || t.status === "FINISH_REQUESTED") return "green";
  if (t.type !== "MEETING" && t.scheduledStart && new Date(t.scheduledStart).getTime() < now.getTime()) return "red";
  return "white";
}

const minuteOf = (d: Date | string) => Math.floor(new Date(d).getTime() / 60000);

export type ToneInput = {
  status: TaskStatus;
  scheduledStart: Date | string | null;
  scheduledEnd: Date | string | null;
  actualStart: Date | string | null;
  actualEnd: Date | string | null;
  /** When the assignee marked it done from their side (FINISH_REQUESTED) — counts as the finish time. */
  finishRequestedAt?: Date | string | null;
};

/**
 * Colour of the time pill once started (owner's rules, ADR 0015), compared at minute precision:
 * - finished (finish requested or completed): on / before the scheduled end → green, after it → red;
 * - running: past the scheduled end → red; started after the scheduled start → red; started on time → green;
 * - nothing recorded yet → null (the pill keeps its pre-start colour).
 */
export function actualTone(t: ToneInput, now: Date = new Date()): "green" | "red" | null {
  const doneAt = t.status === "FINISH_REQUESTED" || t.status === "COMPLETED" ? (t.finishRequestedAt ?? t.actualEnd) : null;
  if (doneAt) return t.scheduledEnd && minuteOf(doneAt) > minuteOf(t.scheduledEnd) ? "red" : "green";
  if (!t.actualStart) return null;
  if (t.scheduledEnd && minuteOf(now) > minuteOf(t.scheduledEnd)) return "red";
  if (t.scheduledStart && minuteOf(t.actualStart) > minuteOf(t.scheduledStart)) return "red";
  return "green";
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
  // Tapping the circle marks a task done "from my side" even before it was started (ADR 0015).
  REQUEST_FINISH: { from: ["DRAFT", "ASSIGNED", "STARTED"], to: "FINISH_REQUESTED" },
  APPROVE_FINISH: { from: ["DRAFT", "ASSIGNED", "STARTED", "FINISH_REQUESTED"], to: "COMPLETED" },
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

/**
 * Overdue evaluation (SPEC §7) — drives the overdue notifications only, not the row colour (ADR 0015): scheduled start
 * missed without starting, or end missed without finish. Marked done from the assignee's side counts as finished.
 */
export function isOverdue(
  t: { status: TaskStatus; scheduledStart: Date | null; scheduledEnd: Date | null; actualStart: Date | null; type?: "WORK" | "MEETING" },
  now: Date,
): boolean {
  if (t.type === "MEETING") return false;
  if (t.status === "COMPLETED" || t.status === "PAUSED" || t.status === "FINISH_REQUESTED") return false;
  if (t.scheduledStart && !t.actualStart && now > t.scheduledStart && (t.status === "ASSIGNED" || t.status === "DRAFT")) return true;
  if (t.scheduledEnd && now > t.scheduledEnd) return true;
  return false;
}

/** Actual worked minutes from sessions, excluding pauses. */
export function workedMinutes(sessions: { startedAt: Date; endedAt: Date | null }[], now = new Date()): number {
  return sessions.reduce((sum, s) => sum + Math.max(0, ((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 60000), 0);
}

export const ACTIVE_STATUSES: TaskStatus[] = ["DRAFT", "ASSIGNED", "STARTED", "PAUSED", "FINISH_REQUESTED"];
