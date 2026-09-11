"use client";
import { Check, Pause, RotateCcw } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { dateChip, fmtMinutes, fmtTime } from "@/lib/time";
import type { TaskRow as Row } from "@/server/tasks/types";
import { fmtShortDate } from "@/components/dashboard/format";

export const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Inline outline icon button used on the icon line of a row (details / Drive / Meet / Chat / Calendar). */
export function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="touch-target-sm flex h-7 w-7 shrink-0 items-center justify-center text-gray-800 disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** Red dot (review requested) — 11px, overlapping a corner of its relative parent. */
export function RedDot({ corner, label }: { corner: "tl" | "tr"; label: string }) {
  return <span aria-label={label} title={label} className={clsx("absolute -top-1 h-[11px] w-[11px] rounded-full bg-[#EF4444]", corner === "tl" ? "-left-1" : "-right-1")} />;
}

const PILL = "inline-flex h-[22px] items-center rounded-full bg-[#E5E7EB] px-2.5 text-[11px] leading-none whitespace-nowrap";

/**
 * Right-hand column of pills (the design the client picked): allocated hours, scheduled start – end,
 * actual start – end once recorded, and the date chip. Right-aligned, stacked.
 */
export function RightPills({ t, tz }: { t: Row; tz: string }) {
  const start = t.scheduledStart ? new Date(t.scheduledStart) : null;
  const end = t.scheduledEnd ? new Date(t.scheduledEnd) : null;
  const overdue = t.overdue && t.colour !== "grey";
  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <span className={clsx(PILL, "relative font-bold text-[#111]")}>
        {t.type === "MEETING" ? "Meet" : fmtMinutes(t.allocatedMinutes)}
        {t.reviewRequested ? <RedDot corner="tl" label="Review requested" /> : null}
      </span>
      <span className={clsx(PILL, overdue ? "text-[#DC2626]" : "text-[#111]")}>
        {fmtTime(start, tz)} – {fmtTime(end, tz)}
      </span>
      {t.actualStart ? (
        <span className={clsx(PILL, "bg-[#F3F4F6] text-[#6B7280]")}>
          {fmtTime(new Date(t.actualStart), tz)} – {t.actualEnd ? fmtTime(new Date(t.actualEnd), tz) : "…"}
        </span>
      ) : null}
      <span className={clsx(PILL, "relative text-[#111]")} title={fmtShortDate(start, tz)}>
        {dateChip(start, new Date(), tz)}
        {t.doubtRaised && t.reviewRequested ? <RedDot corner="tr" label="Doubt and review" /> : null}
      </span>
    </div>
  );
}

/**
 * 30px completion circle (SPEC §5.2): black ring by default, filled yellow on doubt, green ring when started,
 * ⏸ inside when paused; completed rows show a ring with a ⟳ glyph — the Restart button.
 */
export function CompletionCircle({ t, onTap, onRestart }: { t: Row; onTap: () => void; onRestart: () => void }) {
  if (t.status === "COMPLETED") {
    return (
      <button
        type="button"
        aria-label="Restart task"
        title="Restart"
        onPointerDown={stop}
        onPointerUp={stop}
        onClick={(e) => {
          e.stopPropagation();
          onRestart();
        }}
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border-2 border-[#111] text-[#111]"
      >
        <RotateCcw size={15} strokeWidth={2.5} />
      </button>
    );
  }
  const ring = t.doubtRaised ? "bg-[#F5B800]" : t.colour === "green" ? "border-2 border-[#16A34A]" : "border-2 border-[#111]";
  return (
    <button
      type="button"
      aria-label="Finish task"
      title="Tap to request finish"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={(e) => {
        e.stopPropagation();
        onTap();
      }}
      className={clsx("flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-transparent text-[#111]", ring)}
    >
      {t.paused ? <Pause size={13} strokeWidth={3} /> : t.status === "FINISH_REQUESTED" ? <Check size={15} strokeWidth={3} aria-label="Finish requested" /> : null}
    </button>
  );
}
