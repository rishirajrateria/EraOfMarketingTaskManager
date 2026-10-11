"use client";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { Sheet, ActionList } from "@/components/ui/Sheet";
import { REVIEW_FIELD_NAME, type ReviewField } from "@/server/tasks/review-fields";

export type PillReviewChoice = "request" | "withdraw" | "resolve" | "flag" | "change" | "actions";

/** Items of the pill menu per role (ADR 0015). Pure — unit-tested. */
export function pillReviewItems(role: DashboardData["role"], t: Pick<TaskRow, "reviewFields" | "status" | "assignees">, field: ReviewField, meId: string): { choice: PillReviewChoice; label: string; hint?: string }[] {
  const name = REVIEW_FIELD_NAME[field];
  const flagged = t.reviewFields.includes(field);
  const items: { choice: PillReviewChoice; label: string; hint?: string }[] = [];
  if (role === "ADMIN") {
    if (flagged) {
      items.push({ choice: "resolve", label: `Mark the ${name} reviewed`, hint: "Removes the red dot for everyone and resolves the request" });
      if (t.status !== "COMPLETED") items.push({ choice: "change", label: `Change the ${name}`, hint: "Opens Edit; saving clears every dot" });
    } else if (t.status !== "COMPLETED") {
      items.push({ choice: "flag", label: `Flag the ${name} for review`, hint: "Puts a red dot on it" });
    }
  } else {
    const mine = role === "TEAM_LEADER" || t.assignees.some((a) => a.id === meId);
    if (mine && flagged) items.push({ choice: "withdraw", label: `Withdraw review of the ${name}` });
    else if (mine && t.status !== "COMPLETED") items.push({ choice: "request", label: `Request review of the ${name}`, hint: "Red dot on this pill for you and Admin; lands in Admin's requests" });
  }
  items.push({ choice: "actions", label: "All task actions" });
  return items;
}

/** Hold / right-click on a date, hours or start-time pill → this sheet. */
export function PillReviewSheet({
  task,
  field,
  data,
  onPick,
  onClose,
}: {
  task: TaskRow | null;
  field: ReviewField | null;
  data: DashboardData;
  onPick: (choice: PillReviewChoice, t: TaskRow, field: ReviewField) => void;
  onClose: () => void;
}) {
  if (!task || !field) return null;
  const items = pillReviewItems(data.role, task, field, data.me.id).map((it) => ({
    label: it.label,
    hint: it.hint,
    onClick: () => {
      onClose();
      onPick(it.choice, task, field);
    },
  }));
  return (
    <Sheet open onClose={onClose}>
      <div className="border-b border-hair px-5 py-3">
        <p className="truncate text-sm font-semibold text-ink">{task.title}</p>
        <p className="text-[11px] text-muted">The {REVIEW_FIELD_NAME[field]}</p>
      </div>
      <div className="pt-3">
        <ActionList items={items} />
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </Sheet>
  );
}
