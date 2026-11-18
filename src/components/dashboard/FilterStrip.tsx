"use client";
import { Pause, Repeat, RotateCcw } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { RowColour } from "@/server/tasks/state";
import type { DashboardFilters } from "@/server/tasks/types";
import { toggleIn, type IconFilter } from "@/components/dashboard/filters";

/**
 * Colour swatches (ADR 0015): red = not started and past its start time, yellow = paused, green = started, purple
 * (with "?") = doubt raised. White is the default row and completed rows are faded (the "completed" toggle), so
 * neither is offered.
 */
export const COLOUR_SWATCHES: { key: RowColour; hex: string; label: string; mark?: string }[] = [
  { key: "red", hex: "#F8CACA", label: "Late to start" },
  { key: "yellow", hex: "#F6E7B4", label: "Paused" },
  { key: "green", hex: "#CBEFCB", label: "Started" },
  { key: "purple", hex: "#E4D7FB", label: "Doubt raised", mark: "?" },
];

const ICON_BTN = "no-select flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] transition";

function IconToggle({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} aria-label={label} title={label} onClick={onClick} className={clsx(ICON_BTN, active ? "bg-primary text-primary-ink" : "text-ink")}>
      {children}
    </button>
  );
}

/**
 * Filter strip (SPEC §5.1), glass bar directly above the filter rows:
 * (Admin: ⏸ all) · ↻ restarted · "completed" · ⟳ recurring · four colour swatches (red / yellow / green / purple "?") · red dot (review
 * requested). The ⏸ toggle is gone (paused = yellow) and doubts are the purple swatch (ADR 0015).
 * Icon toggles are OR-ed within `filters.icons`; swatches within `filters.colours`.
 */
export function FilterStrip({ filters, onChange, onPauseAll }: { filters: DashboardFilters; onChange: (f: DashboardFilters) => void; onPauseAll?: () => void }) {
  const icon = (key: IconFilter) => filters.icons.includes(key);
  const toggleIcon = (key: IconFilter) => {
    const icons = toggleIn(filters.icons, key);
    // The legacy recurringOnly / pausedOnly toggles are superseded by the icon group; clear them so they cannot linger unseen.
    onChange({ ...filters, icons, recurringOnly: key === "recurring" ? false : filters.recurringOnly, pausedOnly: false });
  };
  const recurringActive = icon("recurring") || filters.recurringOnly;
  return (
    <div className="strip-glass scrollbar-none relative z-[1] flex h-11 shrink-0 items-center justify-between gap-1 overflow-x-auto px-2" role="group" aria-label="Filter by state and row colour">
      {onPauseAll ? (
        <button
          type="button"
          onClick={onPauseAll}
          aria-label="Pause all"
          title="Pause or resume all tasks shown"
          className="no-select flex h-[26px] shrink-0 items-center gap-0.5 rounded-full border border-hair px-2 text-[11.5px] font-semibold leading-none text-ink glass-chip"
        >
          <Pause size={11} strokeWidth={3} fill="currentColor" aria-hidden />
          all
        </button>
      ) : null}
      <IconToggle active={icon("restarted")} label="Restarted tasks" onClick={() => toggleIcon("restarted")}>
        <RotateCcw size={15} strokeWidth={2.5} />
      </IconToggle>
      <button
        type="button"
        aria-pressed={filters.completed}
        title="Show completed tasks"
        onClick={() => onChange({ ...filters, completed: !filters.completed })}
        className={clsx("no-select h-[26px] shrink-0 rounded-full px-2.5 text-[11.5px] leading-none transition", filters.completed ? "bg-[#9CA3AF] text-white" : "glass-chip text-[#9CA3AF]")}
      >
        completed
      </button>
      <IconToggle active={recurringActive} label="Recurring tasks" onClick={() => toggleIcon("recurring")}>
        <Repeat size={15} strokeWidth={2.5} />
      </IconToggle>
      {COLOUR_SWATCHES.map((c) => {
        const active = filters.colours.includes(c.key);
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            aria-label={c.label}
            title={c.label}
            onClick={() => onChange({ ...filters, colours: toggleIn(filters.colours, c.key) })}
            className={clsx("no-select flex h-5 w-[30px] shrink-0 items-center justify-center rounded-[7px] border border-hair text-[13px] font-black leading-none text-[#6d28d9] shadow-sm transition", active && "ring-2 ring-inset ring-primary")}
            style={{ backgroundColor: c.hex }}
          >
            {c.mark ?? null}
          </button>
        );
      })}
      <button
        type="button"
        aria-pressed={icon("review")}
        aria-label="Review requested"
        title="Review requested"
        onClick={() => toggleIcon("review")}
        className={clsx("no-select flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]", icon("review") && "bg-primary")}
      >
        <span className="block h-3 w-3 rounded-full bg-[#EF4444]" />
      </button>
    </div>
  );
}
