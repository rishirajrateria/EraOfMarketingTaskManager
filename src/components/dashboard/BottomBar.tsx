"use client";
import { useEffect, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { DashboardData, DashboardFilters } from "@/server/tasks/types";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { FilterStrip } from "@/components/dashboard/FilterStrip";
import { MeetIcon } from "@/components/dashboard/GoogleIcons";
import { dayLabel } from "@/components/dashboard/summary";
import { DockPill, FilterRow } from "@/components/ui/FilterRow";

export type AddMode = "WORK" | "MEETING" | "CHOOSE";

/** Dock picker names per role: [sheet title, chip label / "All …"]. */
export function dockNames(role: DashboardData["role"]) {
  return {
    row1: role === "ADMIN" ? ["Team", "Teams"] : role === "TEAM_LEADER" ? ["Person", "People"] : ["Client", "Clients"],
    row2: role === "EXECUTIVE" ? ["Work", "Work"] : ["Client", "Clients"],
  } as const;
}

/** Sheet pill (the prototype's `.seg` buttons). */
function Opt({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={clsx("no-select h-9 max-w-full truncate rounded-full border px-3.5 text-[13px] font-semibold", on ? "border-transparent bg-primary text-primary-ink" : "glass-chip border-hair text-ink")}
    >
      {children}
    </button>
  );
}

/** "Which day?": Any day / Today / Tomorrow / Oldest first, or a date. */
function DaySheet({ open, filters, onPick, onClose }: { open: boolean; filters: DashboardFilters; onPick: (quick: DashboardFilters["quick"], date: string | null) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(filters.date ?? "");
  useEffect(() => {
    if (open) setDraft(filters.date ?? "");
  }, [open, filters.date]);
  return (
    <Sheet open={open} onClose={onClose} title="Which day?">
      <div className="space-y-3 px-5 pb-6 pt-2">
        <div className="flex flex-wrap gap-2">
          <Opt on={!filters.date && !filters.quick} onClick={() => onPick(null, null)}>
            Any day
          </Opt>
          <Opt on={filters.quick === "today"} onClick={() => onPick("today", null)}>
            Today
          </Opt>
          <Opt on={filters.quick === "tomorrow"} onClick={() => onPick("tomorrow", null)}>
            Tomorrow
          </Opt>
          <Opt on={filters.quick === "asc"} onClick={() => onPick("asc", null)}>
            Oldest first
          </Opt>
        </div>
        <label className="block text-[10.5px] font-semibold uppercase tracking-[.07em] text-muted">
          Or pick a date
          <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} className={clsx(inputCls, "mt-1 font-normal normal-case tracking-normal")} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} onClick={() => (draft ? onPick(null, draft) : onClose())}>
            Show
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Bottom zone (prototype `prow` / `.plab`, ADR 0015): the status strip, then neutral glass one-tap rows — TEAMS (TL:
 * PEOPLE, Exec: CLIENTS) and CLIENTS (Exec: WORK), each "All" + a pill per item — and the bar: 📅 date (Which day?),
 * Today, Tomorrow, Oldest on the left; the Meet icon (add a meeting) and a blue + (add a task) on the right.
 */
export function BottomBar({
  data,
  filters,
  onChange,
  onAdd,
  onPauseAll,
}: {
  data: DashboardData;
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  onAdd: (mode: AddMode) => void;
  /** Admin only: the strip's "⏸ all". */
  onPauseAll?: () => void;
}) {
  const [dayOpen, setDayOpen] = useState(false);
  const names = dockNames(data.role);
  const setRow = (key: "row1" | "row2") => (id: string | null) => onChange({ ...filters, [key]: id, pill: null });
  const quick = (q: NonNullable<DashboardFilters["quick"]>) => onChange({ ...filters, quick: filters.quick === q ? null : q, date: null, pill: null });
  return (
    <section className="shrink-0 pb-[env(safe-area-inset-bottom)]" aria-label="Filters">
      <FilterStrip filters={filters} onChange={onChange} onPauseAll={data.role === "ADMIN" ? onPauseAll : undefined} />
      <div className="bar-glass border-t border-hair pt-1">
        <FilterRow label={names.row1[1]} items={data.row1} value={filters.row1} onChange={setRow("row1")} />
        <FilterRow label={names.row2[1]} items={data.row2} value={filters.row2} onChange={setRow("row2")} />
        <div className="flex h-14 items-center gap-1.5 pl-3 pr-2.5">
          <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            <DockPill on={!!filters.date} onClick={() => setDayOpen(true)} label="Pick a date">
              <CalendarDays size={16} strokeWidth={2.25} aria-hidden />
              {filters.date ? <span>{dayLabel(filters)}</span> : null}
            </DockPill>
            <DockPill on={filters.quick === "today"} onClick={() => quick("today")}>
              Today
            </DockPill>
            <DockPill on={filters.quick === "tomorrow"} onClick={() => quick("tomorrow")}>
              Tomorrow
            </DockPill>
            <DockPill on={filters.quick === "asc"} onClick={() => quick("asc")}>
              Oldest
            </DockPill>
          </div>
          <button type="button" aria-label="Schedule a meeting" title="Meeting" onClick={() => onAdd("MEETING")} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <MeetIcon size={22} />
          </button>
          <button
            type="button"
            aria-label="Add task"
            title="Add task"
            onClick={() => onAdd("WORK")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,.7)]"
          >
            <Plus size={24} strokeWidth={2.75} />
          </button>
        </div>
      </div>
      <DaySheet
        open={dayOpen}
        filters={filters}
        onClose={() => setDayOpen(false)}
        onPick={(q, date) => {
          onChange({ ...filters, quick: q, date, pill: null });
          setDayOpen(false);
        }}
      />
    </section>
  );
}
