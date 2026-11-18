"use client";
import { useEffect, useState } from "react";
import type { TaskRow } from "@/server/tasks/types";
import { Sheet } from "@/components/ui/Sheet";
import { btnSecondary, inputCls } from "@/components/ui/Field";
import { clsx } from "@/lib/clsx";

/** Open tasks the "Pause all" sheet acts on, split into those it would pause / resume (pure — unit-tested). */
export function pauseAllSplit(shown: Pick<TaskRow, "id" | "status">[]) {
  const open = shown.filter((t) => t.status !== "COMPLETED");
  return {
    toPause: open.filter((t) => t.status === "ASSIGNED" || t.status === "DRAFT" || t.status === "STARTED" || t.status === "FINISH_REQUESTED").map((t) => t.id),
    toResume: open.filter((t) => t.status === "PAUSED").map((t) => t.id),
  };
}

/** Admin "⏸ all" (prototype `pauseAllSheet`, ADR 0015): pause or resume every open task the filters show. */
export function PauseAllSheet({
  open,
  shown,
  scope,
  busy,
  onRun,
  onClose,
}: {
  open: boolean;
  shown: Pick<TaskRow, "id" | "status">[];
  /** "Graphic · today" or "all open tasks". */
  scope: string;
  busy?: boolean;
  onRun: (action: "PAUSE" | "RESUME", taskIds: string[], reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const { toPause, toResume } = pauseAllSplit(shown);
  return (
    <Sheet open={open} onClose={onClose} title="Pause all">
      <div className="space-y-3 px-5 pb-6 pt-2">
        <p className="text-[13px] leading-snug text-muted">
          Applies to the tasks shown right now: <b className="text-ink">{scope}</b>. Assignees are notified; each card shows ⏸ and turns yellow.
        </p>
        <div className="glass-card divide-y divide-[var(--line)] px-3 text-sm">
          <div className="flex justify-between py-2">
            <span className="text-muted">Open, running</span>
            <b className="tabular-nums text-ink">{toPause.length}</b>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-muted">Already paused</span>
            <b className="tabular-nums text-ink">{toResume.length}</b>
          </div>
        </div>
        <label className="block text-[10.5px] font-semibold uppercase tracking-[.07em] text-muted">
          Reason
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Optional — e.g. Office closed for Diwali"
            className={clsx(inputCls, "mt-1 h-auto py-2 text-[14px] font-normal normal-case tracking-normal")}
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} disabled={busy || !toResume.length} onClick={() => onRun("RESUME", toResume, reason)}>
            Resume all ({toResume.length})
          </button>
          <button
            type="button"
            disabled={busy || !toPause.length}
            onClick={() => onRun("PAUSE", toPause, reason)}
            className="h-[46px] rounded-[14px] bg-[#d97706] px-4 text-sm font-semibold text-white shadow-[0_8px_20px_-8px_rgba(217,119,6,.7)] disabled:opacity-50"
          >
            Pause all ({toPause.length})
          </button>
        </div>
      </div>
    </Sheet>
  );
}
