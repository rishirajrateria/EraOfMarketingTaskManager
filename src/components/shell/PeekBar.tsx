"use client";
import { ChevronUp, Plus } from "lucide-react";
import { BottomZone } from "@/components/ui/BottomZone";

/**
 * The "+" list flow's minimised add form (ADR 0016 addendum, prototype `.peek` / `.peekbtn`): a 46px glass bar just
 * above the bottom nav — [blue + square] Add executive ⌃. Tapping it expands the form again.
 */
export function PeekButton({ label, onExpand }: { label: string; onExpand: () => void }) {
  return (
    <button
      type="button"
      data-peek
      onClick={onExpand}
      aria-label={`${label} (expand)`}
      aria-haspopup="dialog"
      aria-expanded={false}
      className="flex h-[46px] w-full items-center gap-2.5 rounded-[14px] border border-hair bg-glass-strong px-2.5 text-[14px] text-ink shadow-glass outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]"
    >
      <span aria-hidden className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] bg-[linear-gradient(150deg,#3b82f6,#1d4ed8)] text-white">
        <Plus size={18} strokeWidth={2.5} />
      </span>
      <b className="min-w-0 flex-1 truncate text-left font-bold">{label}</b>
      <ChevronUp aria-hidden size={20} strokeWidth={2.25} className="shrink-0 text-muted" />
    </button>
  );
}

/**
 * A list page's bottom zone while the bar shows: the page's search strip and filter rows (if any) stay, its "+ Add" bar
 * gives way to the peek button (no duplicate add button).
 */
export function PeekZone({ label, onExpand, strip, rows }: { label: string; onExpand: () => void; strip?: React.ReactNode; rows?: React.ReactNode }) {
  return <BottomZone strip={strip} rows={rows} actions={<PeekButton label={label} onExpand={onExpand} />} />;
}
