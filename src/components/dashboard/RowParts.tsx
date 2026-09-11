"use client";
import { Check, Pause, RotateCcw } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { dateChip, fmtMinutes } from "@/lib/time";
import type { TaskRow as Row } from "@/server/tasks/types";
import { fmtClock, fmtShortDate } from "@/components/dashboard/format";

export const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** 14px inline icon button used on line 2 of a row (details / Drive / mic / Chat / Meet). */
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
      className="flex h-5 w-[13px] shrink-0 items-center justify-center text-gray-700 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Red dot (review requested) — 11px, overlapping a corner of its relative parent. */
export function RedDot({ corner, label }: { corner: "tl" | "tr"; label: string }) {
  return <span aria-label={label} title={label} className={clsx("absolute -top-1 h-[11px] w-[11px] rounded-full bg-[#EF4444]", corner === "tl" ? "-left-1" : "-right-1")} />;
}

/** Grey time pill: allocated · scheduled start · scheduled end (red when overdue); actual start/end underneath. */
export function TimePill({ t, tz }: { t: Row; tz: string }) {
  const sched = t.overdue && t.colour !== "grey" ? "text-[#DC2626]" : "text-[#111]";
  return (
    <div className="flex shrink-0 flex-col items-end">
      <div className="relative flex h-[22px] items-center gap-2.5 rounded-full bg-[#E5E7EB] px-2 text-[11px] leading-none">
        <span className="font-bold text-[#111]">{t.type === "MEETING" ? "Meet" : fmtMinutes(t.allocatedMinutes)}</span>
        <span className={sched}>{fmtClock(t.scheduledStart, tz)}</span>
        <span className={sched}>{fmtClock(t.scheduledEnd, tz)}</span>
        {t.reviewRequested ? <RedDot corner="tl" label="Review requested" /> : null}
      </div>
      {t.actualStart ? (
        <div className="mt-0.5 pr-2 text-right text-[11px] leading-3 text-[#6B7280]">
          {fmtClock(t.actualStart, tz)}
          <span className="inline-block w-2.5" />
          {t.actualEnd ? fmtClock(t.actualEnd, tz) : "…"}
        </div>
      ) : null}
    </div>
  );
}

/** "Today" / "Yestr" / "Tom" / "9 Sep" chip with the full d/M/yy date underneath (46px column). */
export function DateChip({ t, tz }: { t: Row; tz: string }) {
  const start = t.scheduledStart ? new Date(t.scheduledStart) : null;
  return (
    <div className="flex w-[46px] shrink-0 flex-col items-end">
      <span className="relative rounded-md bg-[#E5E7EB] px-1.5 text-[11px] leading-[18px] text-[#111]">
        {dateChip(start, new Date(), tz)}
        {t.doubtRaised && t.reviewRequested ? <RedDot corner="tr" label="Doubt and review" /> : null}
      </span>
      <span className="mt-0.5 text-[10px] leading-3 text-[#374151]">{fmtShortDate(start, tz)}</span>
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
