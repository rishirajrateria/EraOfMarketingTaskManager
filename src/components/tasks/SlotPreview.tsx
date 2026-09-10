"use client";
import { useEffect, useState } from "react";
import { clsx } from "@/lib/clsx";
import { btnPrimary, btnSecondary } from "@/components/ui/Field";
import { previewSlot } from "@/server/tasks/create";
import { formatSlot } from "@/components/tasks/add-task-helpers";

type Slot = { start: Date | string; end: Date | string; displaced: string[] };

/**
 * Shows the next-available slot the server would pick (SPEC §9.2 step 5) so the creator can accept it or
 * switch to manual date/time. Re-queries (debounced 400ms) whenever assignees or allocated time change.
 */
export function SlotPreview({
  assigneeIds,
  allocatedMinutes,
  tz,
  accepted,
  onAccept,
  onPickManually,
}: {
  assigneeIds: string[];
  allocatedMinutes: number;
  tz: string;
  accepted: boolean;
  onAccept: () => void;
  onPickManually: () => void;
}) {
  const [slot, setSlot] = useState<Slot | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "none" | "error" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const key = `${assigneeIds.join(",")}|${allocatedMinutes}`;

  useEffect(() => {
    if (!assigneeIds.length) {
      setState("idle");
      setSlot(null);
      return;
    }
    let cancelled = false;
    setState("loading");
    const t = setTimeout(async () => {
      const res = await previewSlot(assigneeIds, allocatedMinutes).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : "Failed" }));
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setState("error");
        return;
      }
      setSlot(res.data);
      setState(res.data ? "ready" : "none");
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className={clsx("rounded-lg border p-3 text-sm", accepted ? "border-brand-green bg-green-50" : "border-brand-blue/40 bg-blue-50")} aria-live="polite">
      <div className="mb-2 flex items-start gap-2">
        <span aria-hidden>{accepted ? "✅" : "🕒"}</span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-gray-500">{accepted ? "Auto slot accepted" : "Next available slot"}</div>
          {state === "idle" ? <div className="text-gray-600">Pick at least one assignee to see a proposed slot.</div> : null}
          {state === "loading" ? <div className="text-gray-600">Finding the next free slot…</div> : null}
          {state === "none" ? <div className="text-red-600">No free slot in the next 60 days — pick a time manually.</div> : null}
          {state === "error" ? <div className="text-red-600">{error}</div> : null}
          {state === "ready" && slot ? (
            <div className="font-semibold text-gray-900">
              Proposed: {formatSlot(slot, tz)}
              {slot.displaced.length ? <span className="ml-1 text-xs font-normal text-amber-700">(shifts {slot.displaced.length} self-assigned task{slot.displaced.length === 1 ? "" : "s"})</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex gap-2">
        {!accepted ? (
          <button type="button" onClick={onAccept} disabled={state !== "ready"} className={clsx(btnPrimary, "flex-1")}>
            Accept
          </button>
        ) : null}
        <button type="button" onClick={onPickManually} className={clsx(btnSecondary, "flex-1")}>
          Pick manually
        </button>
      </div>
      <p className="mt-2 text-[11px] text-gray-500">The slot is recomputed on save; if it moved you will see the final time on the task.</p>
    </div>
  );
}
