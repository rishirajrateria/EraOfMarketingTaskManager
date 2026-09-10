"use client";
import { Pause, Repeat, Star } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { RowColour } from "@/server/tasks/state";
import type { DashboardFilters } from "@/server/tasks/types";
import { toggleIn, type IconFilter } from "@/components/dashboard/filters";

export const COLOUR_SWATCHES: { key: RowColour; cls: string; label: string }[] = [
  { key: "white", cls: "bg-white", label: "Not started" },
  { key: "green", cls: "bg-green-400", label: "Ongoing" },
  { key: "yellow", cls: "bg-yellow-300", label: "Doubt" },
  { key: "red", cls: "bg-red-500", label: "Overdue" },
  { key: "grey", cls: "bg-gray-400", label: "Completed" },
];

const ICON_TOGGLES: { key: IconFilter; label: string; node: React.ReactNode }[] = [
  { key: "paused", label: "Paused", node: <Pause size={13} strokeWidth={3} /> },
  { key: "doubt", label: "Doubt raised", node: <span className="block h-3 w-3 rounded-full bg-yellow-300" /> },
  { key: "review", label: "Review requested", node: <span className="block h-2.5 w-2.5 rounded-full bg-red-500" /> },
  { key: "important", label: "Important", node: <Star size={13} className="fill-current" /> },
  { key: "recurring", label: "Recurring", node: <Repeat size={13} strokeWidth={2.5} /> },
];

/**
 * Filter strip (SPEC §5.1): row-colour swatches (multi-select) + icon-state toggles.
 * Used full-size in the blue area and as tiny swatches in the bottom bar.
 */
export function FilterStrip({
  filters,
  onChange,
  size = "md",
  showIcons = true,
  onDark = true,
}: {
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  size?: "md" | "xs";
  showIcons?: boolean;
  onDark?: boolean;
}) {
  const dot = size === "md" ? "h-5 w-5" : "h-3.5 w-3.5";
  const hit = size === "md" ? "h-9 w-9" : "h-7 w-6";
  const toggleColour = (key: RowColour) => {
    const colours = toggleIn(filters.colours, key);
    // Selecting the grey swatch implies showing completed rows, otherwise the filter can never match.
    const completed = key === "grey" && colours.includes("grey") ? true : filters.completed;
    onChange({ ...filters, colours, completed });
  };
  return (
    <div className={clsx("flex items-center", size === "md" ? "gap-1" : "gap-0")} role="group" aria-label="Filter by row colour and state">
      {COLOUR_SWATCHES.map((c) => {
        const active = filters.colours.includes(c.key);
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={active}
            aria-label={c.label}
            title={c.label}
            onClick={() => toggleColour(c.key)}
            className={clsx("no-select flex shrink-0 items-center justify-center rounded-full", hit)}
          >
            <span
              className={clsx(
                "block rounded-full border transition",
                dot,
                c.cls,
                active ? (onDark ? "ring-2 ring-white ring-offset-2 ring-offset-brand-blue" : "ring-2 ring-gray-900 ring-offset-1") : "border-black/20 opacity-80",
              )}
            />
          </button>
        );
      })}
      {showIcons ? (
        <>
          <span className={clsx("mx-1 h-5 w-px", onDark ? "bg-white/40" : "bg-gray-300")} />
          {ICON_TOGGLES.map((i) => {
            const active = filters.icons.includes(i.key);
            return (
              <button
                key={i.key}
                type="button"
                aria-pressed={active}
                aria-label={i.label}
                title={i.label}
                onClick={() => onChange({ ...filters, icons: toggleIn(filters.icons, i.key) })}
                className={clsx(
                  "no-select flex shrink-0 items-center justify-center rounded-full transition",
                  hit,
                  active ? (onDark ? "bg-white text-brand-blue" : "bg-gray-900 text-white") : onDark ? "text-white/80" : "text-gray-600",
                )}
              >
                {i.node}
              </button>
            );
          })}
        </>
      ) : null}
    </div>
  );
}
