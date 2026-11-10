/**
 * Tasks a shift never moves automatically (ADR 0019 leave shift, ADR 0022 early-leave shift): the inbox / sheet lists
 * them as "Move yourself". Pure and client-safe.
 */
/** Why a task is never moved automatically: it is under way (started, paused, done from their side), a meeting, or fixed. */
export type UnmovableReason = "started" | "paused" | "finish-requested" | "meeting" | "protected";

export function unmovableReason(t: { status: string; type: string; protected: boolean }): UnmovableReason | null {
  if (t.type === "MEETING") return "meeting";
  if (t.status === "STARTED") return "started";
  if (t.status === "PAUSED") return "paused";
  if (t.status === "FINISH_REQUESTED") return "finish-requested";
  if (t.protected) return "protected";
  return null;
}

export const UNMOVABLE_LABEL: Record<UnmovableReason, string> = {
  started: "started",
  paused: "paused",
  "finish-requested": "done from their side",
  meeting: "meeting",
  protected: "fixed",
};
