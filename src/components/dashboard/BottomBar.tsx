"use client";
import { CalendarDays, Pause, Plus, Repeat, Video } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { fmtDate, parseDateKey } from "@/lib/time";
import type { DashboardData, DashboardFilters } from "@/server/tasks/types";
import { Pill } from "@/components/ui/Pill";
import { FilterStrip } from "@/components/dashboard/FilterStrip";

export type AddMode = "WORK" | "MEETING" | "CHOOSE";

function PillRow({ label, items, value, onChange }: { label: string; items: { id: string; label: string }[]; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto px-3 py-1" role="group" aria-label={label}>
      <Pill active={value === null} onClick={() => onChange(null)}>
        All
      </Pill>
      {items.map((it) => (
        <Pill key={it.id} active={value === it.id} onClick={() => onChange(value === it.id ? null : it.id)}>
          {it.label}
        </Pill>
      ))}
    </div>
  );
}

function ToggleBtn({ active, label, onClick, children, className }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx(
        "no-select flex h-9 shrink-0 items-center justify-center rounded-full px-2 text-xs font-medium transition",
        active ? "bg-white text-brand-green-dark shadow" : "bg-white/20 text-white",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Bottom green area (SPEC §5.4): two filter pill rows + the bottom bar
 * (date picker, quick pills, completed / loop / pause toggles, colour swatches, Meet · Work · +).
 */
export function BottomBar({
  data,
  filters,
  onChange,
  onOpenDate,
  onAdd,
}: {
  data: DashboardData;
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  onOpenDate: () => void;
  onAdd: (mode: AddMode) => void;
}) {
  const row1Label = data.role === "ADMIN" ? "Teams" : data.role === "TEAM_LEADER" ? "Executives" : "Clients";
  const row2Label = data.role === "EXECUTIVE" ? "Work types" : "Clients";
  const quick = (q: DashboardFilters["quick"]) => onChange({ ...filters, quick: filters.quick === q ? null : q });
  return (
    <section className="sticky bottom-0 z-20 bg-brand-green pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-2px_8px_rgba(0,0,0,0.15)]" aria-label="Filters">
      <PillRow label={row1Label} items={data.row1} value={filters.row1} onChange={(row1) => onChange({ ...filters, row1 })} />
      <PillRow label={row2Label} items={data.row2} value={filters.row2} onChange={(row2) => onChange({ ...filters, row2 })} />
      <div className="flex items-center gap-1 border-t border-white/20 px-2 py-1.5">
        <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <ToggleBtn active={!!filters.date} label="Pick a date" onClick={onOpenDate} className="gap-1">
            <CalendarDays size={16} />
            {filters.date ? <span>{fmtDate(parseDateKey(filters.date, data.tz), data.tz)}</span> : null}
          </ToggleBtn>
          <ToggleBtn active={filters.quick === "asc"} label="Sort ascending" onClick={() => quick("asc")}>
            Ascending
          </ToggleBtn>
          <ToggleBtn active={filters.quick === "tomorrow"} label="Tomorrow only" onClick={() => quick("tomorrow")}>
            Tomorrow
          </ToggleBtn>
          <ToggleBtn active={filters.quick === "today"} label="Today only" onClick={() => quick("today")}>
            Today
          </ToggleBtn>
          <ToggleBtn active={filters.completed} label="Show completed" onClick={() => onChange({ ...filters, completed: !filters.completed })}>
            completed
          </ToggleBtn>
          <ToggleBtn active={filters.recurringOnly} label="Recurring only" onClick={() => onChange({ ...filters, recurringOnly: !filters.recurringOnly })} className="w-9 px-0">
            <Repeat size={15} strokeWidth={2.5} />
          </ToggleBtn>
          <ToggleBtn active={filters.pausedOnly} label="Paused only" onClick={() => onChange({ ...filters, pausedOnly: !filters.pausedOnly })} className="w-9 px-0">
            <Pause size={15} strokeWidth={3} />
          </ToggleBtn>
          <FilterStrip filters={filters} onChange={onChange} size="xs" showIcons={false} />
        </div>
        <div className="flex shrink-0 items-center gap-1 pl-1">
          <button type="button" aria-label="Schedule a meeting" title="Meeting" onClick={() => onAdd("MEETING")} className="touch-target flex items-center justify-center rounded-full bg-white/20 text-white active:bg-white/40">
            <Video size={20} />
          </button>
          <button type="button" onClick={() => onAdd("WORK")} className="touch-target rounded-full bg-white/20 px-3 text-sm font-semibold text-white active:bg-white/40">
            Work
          </button>
          <button type="button" aria-label="Add task" onClick={() => onAdd("CHOOSE")} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-brand-green-dark shadow-lg active:bg-gray-100">
            <Plus size={26} strokeWidth={3} />
          </button>
        </div>
      </div>
    </section>
  );
}
