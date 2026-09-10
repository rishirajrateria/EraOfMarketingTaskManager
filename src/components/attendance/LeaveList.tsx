"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { LeaveSummary } from "@/server/leave/queries";
import { requestLeaveChange } from "@/server/leave/actions";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnDanger, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

export const LEAVE_STATUS_STYLE: Record<LeaveSummary["status"], { label: string; cls: string }> = {
  REQUESTED: { label: "Pending HR", cls: "bg-amber-100 text-amber-800" },
  HR_APPROVED: { label: "Approved (HR)", cls: "bg-green-100 text-green-800" },
  ADMIN_APPROVED: { label: "Approved (Admin)", cls: "bg-green-100 text-green-800" },
  REJECTED: { label: "Rejected / cancelled", cls: "bg-red-100 text-red-800" },
};

export const isApprovedLeave = (s: LeaveSummary["status"]) => s === "HR_APPROVED" || s === "ADMIN_APPROVED";

export function fmtLeaveRange(l: { from: string; to: string }) {
  return l.from === l.to ? l.from : `${l.from} → ${l.to}`;
}

export function LeaveStatusPill({ status }: { status: LeaveSummary["status"] }) {
  const s = LEAVE_STATUS_STYLE[status];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${s.cls}`}>{s.label}</span>;
}

function ChangeSheet({ leave, onClose }: { leave: LeaveSummary; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(leave.from);
  const [to, setTo] = useState(leave.to);
  const [reason, setReason] = useState(leave.reason);

  const send = (change: { cancel: true } | { from: string; to: string; reason: string }) =>
    start(async () => {
      const r = await requestLeaveChange(leave.id, change);
      if (!r.ok) return toast(r.error, "err");
      toast("Sent to Admin for approval");
      onClose();
      router.refresh();
    });

  return (
    <Sheet open onClose={onClose} title="Change approved leave">
      <div className="space-y-3 px-4 py-4">
        <p className="text-xs text-gray-500">Changes to an approved leave need Admin approval.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From">
            <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" min={from} className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason">
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button className={btnDanger} disabled={pending} onClick={() => send({ cancel: true })}>
            Cancel leave
          </button>
          <button className={btnSecondary} disabled={pending} onClick={onClose}>
            Close
          </button>
          <button className={btnPrimary} disabled={pending} onClick={() => send({ from, to, reason })}>
            Request change
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function LeaveList({ leaves }: { leaves: LeaveSummary[] }) {
  const [editing, setEditing] = useState<LeaveSummary | null>(null);
  if (leaves.length === 0) return <p className="mx-3 mt-3 text-xs text-gray-400">No leaves yet.</p>;
  return (
    <ul className="mx-3 mt-3 divide-y rounded-xl bg-white shadow-sm">
      {leaves.map((l) => (
        <li key={l.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{fmtLeaveRange(l)}</div>
            {l.reason ? <div className="truncate text-xs text-gray-500">{l.reason}</div> : null}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <LeaveStatusPill status={l.status} />
              {l.pendingChange ? (
                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800">
                  {"cancel" in l.pendingChange.payload ? "Cancellation" : "Change"} pending Admin
                </span>
              ) : null}
            </div>
          </div>
          {isApprovedLeave(l.status) && !l.pendingChange ? (
            <button className={btnSecondary} onClick={() => setEditing(l)}>
              Change
            </button>
          ) : null}
        </li>
      ))}
      {editing ? <ChangeSheet key={editing.id} leave={editing} onClose={() => setEditing(null)} /> : null}
    </ul>
  );
}
