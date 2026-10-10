"use client";
import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { DashboardData, DashboardFilters } from "@/server/tasks/types";
import { Sheet } from "@/components/ui/Sheet";
import { SheetButtons } from "@/components/ui/CloseX";
import { btnPrimary, inputCls } from "@/components/ui/Field";
import { FilterStrip } from "@/components/dashboard/FilterStrip";
import { dayLabel, summaryCaption } from "@/components/dashboard/summary";
import { FilterTray } from "@/components/dashboard/FilterTray";
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
        <SheetButtons>
          <button type="button" className={btnPrimary} onClick={() => (draft ? onPick(null, draft) : onClose())}>
            Show
          </button>
        </SheetButtons>
      </div>
    </Sheet>
  );
}

/**
 * Bottom zone (prototype `prow` / `.plab` / `#dashNav`, ADR 0015 + ADR 0016 addendum): the status strip, then neutral
 * glass one-tap rows — TEAMS (TL: PEOPLE, Exec: CLIENTS) and CLIENTS (Exec: WORK) — then the time pills on their own
 * row (📅 Which day? · Today · Tomorrow · Oldest) — all in the minimisable FilterTray (its tab collapses it to
 * "Filters · <active filters>"). The 64px nav row with the + below it is the shell's bottom nav (GlobalNav), shared by
 * every screen; the dashboard's height already leaves room for it.
 */
export function BottomBar({
  data,
  filters,
  onChange,
  onPauseAll,
}: {
  data: DashboardData;
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  /** Admin only: the strip's "⏸ all". */
  onPauseAll?: () => void;
}) {
  const [dayOpen, setDayOpen] = useState(false);
  const names = dockNames(data.role);
  const setRow = (key: "row1" | "row2") => (id: string | null) => onChange({ ...filters, [key]: id, pill: null });
  const quick = (q: NonNullable<DashboardFilters["quick"]>) => onChange({ ...filters, quick: filters.quick === q ? null : q, date: null, pill: null });
  const tray = (
    <FilterTray userId={data.me.id} label={`Filters · ${summaryCaption(data, filters)}`}>
      <FilterStrip filters={filters} onChange={onChange} onPauseAll={data.role === "ADMIN" ? onPauseAll : undefined} />
      <div className="bar-glass border-t border-hair pt-1">
        <FilterRow label={names.row1[1]} items={data.row1} value={filters.row1} onChange={setRow("row1")} />
        <FilterRow label={names.row2[1]} items={data.row2} value={filters.row2} onChange={setRow("row2")} />
        <div className="scrollbar-none flex h-14 items-center gap-1.5 overflow-x-auto px-3">
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
      </div>
    </FilterTray>
  );
  return (
    <>
      {tray}
      <DaySheet
        open={dayOpen}
        filters={filters}
        onClose={() => setDayOpen(false)}
        onPick={(q, date) => {
          onChange({ ...filters, quick: q, date, pill: null });
          setDayOpen(false);
        }}
      />
    </>
  );
}
