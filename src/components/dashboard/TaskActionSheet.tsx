"use client";
import { useRouter } from "next/navigation";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { canTransition } from "@/server/tasks/state";
import { Sheet, ActionList } from "@/components/ui/Sheet";
import { statusLabel } from "@/components/dashboard/format";

/** Notes that need a textarea before calling the server (handled by the Dashboard root via NoteSheet). */
export type NoteKind = "reject" | "doubt" | "review" | "time_change" | "fix_self";

export const NOTE_PROMPTS: Record<NoteKind, { title: string; placeholder: string; success: string }> = {
  reject: { title: "Reject finish", placeholder: "Why is this not finished yet?", success: "Finish rejected" },
  doubt: { title: "Raise doubt", placeholder: "Describe the doubt for Admin…", success: "Doubt raised" },
  review: { title: "Review request", placeholder: "What should Admin review?", success: "Review requested" },
  time_change: { title: "Time-change request", placeholder: "Which time / date do you need?", success: "Time change requested" },
  fix_self: { title: "Request fix for self-assigned task", placeholder: "Why should this task be protected?", success: "Fix requested" },
};

/** Simple actions (no note) the sheet can ask the root to run. */
export type SimpleAction =
  | "start"
  | "request_finish"
  | "approve_finish"
  | "pause"
  | "resume"
  | "restart"
  | "resolve_doubt"
  | "protect"
  | "unprotect"
  | "retry"
  | "edit"
  | "delete"
  | "details";

type Item = { label: string; onClick: () => void; danger?: boolean; hint?: string };

/** Long-press action sheet (SPEC §5.3) — items are gated by role AND task state (canTransition). */
export function TaskActionSheet({
  task,
  data,
  open,
  onClose,
  onAction,
  onNote,
}: {
  task: TaskRow | null;
  data: DashboardData;
  open: boolean;
  onClose: () => void;
  onAction: (action: SimpleAction, task: TaskRow) => void;
  onNote: (kind: NoteKind, task: TaskRow) => void;
}) {
  const router = useRouter();
  if (!task) return null;
  const t = task;
  const role = data.role;
  const mine = t.assignees.some((a) => a.id === data.me.id);
  const act = (a: SimpleAction) => () => {
    onClose();
    onAction(a, t);
  };
  const note = (k: NoteKind) => () => {
    onClose();
    onNote(k, t);
  };
  const s = t.status;
  const items: Item[] = [];

  if (role === "ADMIN") {
    if (canTransition(s, "START")) items.push({ label: "Start", onClick: act("start") });
    if (canTransition(s, "REQUEST_FINISH")) items.push({ label: "Request finish", onClick: act("request_finish") });
    if (canTransition(s, "APPROVE_FINISH")) items.push({ label: "Approve finish", onClick: act("approve_finish"), hint: s === "FINISH_REQUESTED" ? "Requested" : undefined });
    if (canTransition(s, "REJECT_FINISH")) items.push({ label: "Reject finish", onClick: note("reject"), hint: "with note" });
    if (canTransition(s, "PAUSE")) items.push({ label: "Pause", onClick: act("pause") });
    if (canTransition(s, "RESUME")) items.push({ label: "Resume", onClick: act("resume") });
    if (s !== "COMPLETED") items.push({ label: "Edit", onClick: act("edit") });
    if (canTransition(s, "RESTART")) items.push({ label: "Restart", onClick: act("restart"), hint: "duplicate as new" });
    if (t.doubtRaised) items.push({ label: "Resolve doubt", onClick: act("resolve_doubt"), hint: "unflag" });
    items.push({ label: "Open request", onClick: () => { onClose(); router.push("/requests"); }, hint: t.reviewRequested || t.doubtRaised || s === "FINISH_REQUESTED" ? "pending" : undefined });
    if (t.selfAssigned) items.push(t.protected ? { label: "Mark unprotected", onClick: act("unprotect") } : { label: "Mark protected", onClick: act("protect"), hint: "fix in place" });
    if (t.integrationError) items.push({ label: "Retry integrations", onClick: act("retry"), hint: "Google" });
    items.push({ label: "Delete", onClick: act("delete"), danger: true });
  } else if (role === "TEAM_LEADER") {
    if (canTransition(s, "START")) items.push({ label: "Start", onClick: act("start") });
    if (canTransition(s, "REQUEST_FINISH")) items.push({ label: "Request finish", onClick: act("request_finish") });
    if (s !== "COMPLETED" && !t.doubtRaised) items.push({ label: "Raise doubt", onClick: note("doubt"), hint: "with note" });
    if (s !== "COMPLETED") {
      items.push({ label: "Raise review request", onClick: note("review"), hint: "with note" });
      items.push({ label: "Raise time-change request", onClick: note("time_change"), hint: "with note" });
    }
    if (canTransition(s, "RESTART")) items.push({ label: "Restart", onClick: act("restart"), hint: "duplicate as new" });
    if (t.selfAssigned && mine && !t.protected && s !== "COMPLETED") items.push({ label: "Request fix for self-assigned task", onClick: note("fix_self") });
  } else {
    items.push({ label: "Open details", onClick: act("details") });
    if (mine && s !== "COMPLETED") {
      items.push({ label: "Raise review request", onClick: note("review"), hint: "with note" });
      items.push({ label: "Raise time-change request", onClick: note("time_change"), hint: "with note" });
      if (t.selfAssigned && !t.protected) items.push({ label: "Request fix for self-assigned task", onClick: note("fix_self") });
    }
  }

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="border-b px-5 py-3">
        <p className="truncate text-sm font-semibold">{t.title}</p>
        <p className="text-[11px] text-gray-500">
          {statusLabel(t)}
          {t.paused ? " · paused" : ""}
          {t.reviewRequested ? " · review requested" : ""}
          {t.protected ? " · protected" : ""}
        </p>
      </div>
      <ActionList items={items} />
      <div className="h-[env(safe-area-inset-bottom)]" />
    </Sheet>
  );
}
