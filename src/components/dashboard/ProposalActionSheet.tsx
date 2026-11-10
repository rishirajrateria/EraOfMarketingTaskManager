"use client";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { Sheet, ActionList } from "@/components/ui/Sheet";
import { proposalWants, proposerName } from "@/components/dashboard/proposal-ui";

export type ProposalAction = "approve" | "edit_approve" | "reject" | "withdraw" | "details";

/**
 * Long-press on a proposal (ADR 0021, prototype `proposalActions`). Admin: Approve · Edit & approve · Reject…; the Team
 * Leader who sent it: Withdraw proposal. Everyone: Details.
 */
export function ProposalActionSheet({
  task,
  data,
  open,
  onClose,
  onAction,
}: {
  task: TaskRow | null;
  data: DashboardData;
  open: boolean;
  onClose: () => void;
  onAction: (a: ProposalAction, t: TaskRow) => void;
}) {
  if (!task) return null;
  const t = task;
  const admin = data.role === "ADMIN";
  const tl = proposerName(t, data.people);
  const act = (a: ProposalAction) => () => {
    onClose();
    onAction(a, t);
  };
  const items: { label: string; onClick: () => void; danger?: boolean; hint?: string }[] = [];
  if (admin) {
    items.push({ label: "Approve", onClick: act("approve"), hint: `Becomes a normal task for ${tl} · ${proposalWants(t)}, else the next free slot` });
    items.push({ label: "Edit & approve", onClick: act("edit_approve"), hint: "Change anything first, then approve" });
    items.push({ label: "Reject…", onClick: act("reject"), danger: true, hint: `A note is required; ${tl} is notified` });
  } else if (t.proposal?.byId === data.me.id) {
    items.push({ label: "Withdraw proposal", onClick: act("withdraw"), danger: true, hint: "Removes it. Nothing was booked." });
  }
  items.push({ label: "Details", onClick: act("details") });
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="border-b border-hair px-5 py-3">
        <p className="truncate text-sm font-semibold">{t.title}</p>
        <p className="text-[11.5px] text-muted">{admin ? `Proposal from ${tl} · no time is held until you approve.` : "Waiting for Admin · no time is held until approved."}</p>
      </div>
      <ActionList items={items} />
      <div className="h-[env(safe-area-inset-bottom)]" />
    </Sheet>
  );
}
