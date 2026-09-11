"use client";
import { Pause, Repeat, RotateCcw } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { RowColour } from "@/server/tasks/state";
import type { DashboardFilters } from "@/server/tasks/types";
import { toggleIn, type IconFilter } from "@/components/dashboard/filters";

/** Colour swatches (46×18 rounded rectangles). White is the default row and grey is "completed", so neither is offered. */
export const COLOUR_SWATCHES: { key: RowColour; hex: string; label: string }[] = [
  { key: "red", hex: "#F8CACA", label: "Overdue" },
  { key: "yellow", hex: "#F6E7B4", label: "Doubt raised" },
  { key: "green", hex: "#CBEFCB", label: "Ongoing" },
];

const ICON_BTN = "no-select flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] transition";

function IconToggle({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={active} aria-label={label} title={label} onClick={onClick} className={clsx(ICON_BTN, active ? "bg-[#111] text-white" : "text-[#111]")}>
      {children}
    </button>
  );
}

/**
 * Filter strip (SPEC §5.1), white bar directly above the green area:
 * ↻ restarted · "completed" · ⟳ recurring · ⏸ paused · three colour swatches · red dot (review requested).
 * Icon toggles are OR-ed within `filters.icons`; swatches within `filters.colours`.
 */
export function FilterStrip({ filters, onChange }: { filters: DashboardFilters; onChange: (f: DashboardFilters) => void }) {
  const icon = (key: IconFilter) => filters.icons.includes(key);
  const toggleIcon = (key: IconFilter) => {
    const icons = toggleIn(filters.icons, key);
    // The legacy recurringOnly / pausedOnly toggles are superseded by the icon group; clear them so they cannot linger unseen.
    onChange({ ...filters, icons, recurringOnly: key === "recurring" ? false : filters.recurringOnly, pausedOnly: key === "paused" ? false : filters.pausedOnly });
  };
  const recurringActive = icon("recurring") || filters.recurringOnly;
  const pausedActive = icon("paused") || filters.pausedOnly;
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-1.5 bg-white px-2.5" role="group" aria-label="Filter by state and row colour">
      <IconToggle active={icon("restarted")} label="Restarted tasks" onClick={() => toggleIcon("restarted")}>
        <RotateCcw size={15} strokeWidth={2.5} />
      </IconToggle>
      <button
        type="button"
        aria-pressed={filters.completed}
        title="Show completed tasks"
        onClick={() => onChange({ ...filters, completed: !filters.completed })}
        className={clsx("no-select h-[22px] shrink-0 rounded-full px-2.5 text-[11px] leading-none transition", filters.completed ? "bg-[#9CA3AF] text-white" : "bg-[#E0E0E0] text-[#9CA3AF]")}
      >
        completed
      </button>
      <IconToggle active={recurringActive} label="Recurring tasks" onClick={() => toggleIcon("recurring")}>
        <Repeat size={15} strokeWidth={2.5} />
      </IconToggle>
      <IconToggle active={pausedActive} label="Paused tasks" onClick={() => toggleIcon("paused")}>
        <Pause size={15} strokeWidth={3} fill="currentColor" />
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
            className={clsx("no-select h-[18px] w-[46px] shrink-0 rounded-[4px] transition", active && "shadow-[inset_0_0_0_2px_#111]")}
            style={{ backgroundColor: c.hex }}
          />
        );
      })}
      <button
        type="button"
        aria-pressed={icon("review")}
        aria-label="Review requested"
        title="Review requested"
        onClick={() => toggleIcon("review")}
        className={clsx("no-select flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]", icon("review") && "bg-[#111]")}
      >
        <span className="block h-3 w-3 rounded-full bg-[#EF4444]" />
      </button>
    </div>
  );
}
