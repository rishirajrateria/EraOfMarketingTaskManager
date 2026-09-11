"use client";
import { CalendarDays, Plus } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { fmtDate, parseDateKey } from "@/lib/time";
import type { DashboardData, DashboardFilters } from "@/server/tasks/types";
import { FilterStrip } from "@/components/dashboard/FilterStrip";
import { MeetIcon } from "@/components/dashboard/GoogleIcons";

export type AddMode = "WORK" | "MEETING" | "CHOOSE";

/** Green-area pill: 22px tall, #A9E0AE, white when active. */
function GreenPill({ active, label, onClick, children }: { active: boolean; label?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx("no-select flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[11px] leading-none text-[#111] transition", active ? "bg-white" : "bg-green-pill")}
    >
      {children}
    </button>
  );
}

function PillRow({ label, items, value, onChange }: { label: string; items: { id: string; label: string }[]; value: string | null; onChange: (id: string | null) => void }) {
  return (
    <div className="scrollbar-none flex h-[34px] items-center gap-1.5 overflow-x-auto px-2.5" role="group" aria-label={label}>
      <GreenPill active={value === null} onClick={() => onChange(null)}>
        All
      </GreenPill>
      {items.map((it) => (
        <GreenPill key={it.id} active={value === it.id} onClick={() => onChange(value === it.id ? null : it.id)}>
          {it.label}
        </GreenPill>
      ))}
    </div>
  );
}

/**
 * Bottom zone (SPEC §5.4): white filter strip · green area (two filter pill rows) · 44px bottom bar
 * (calendar + quick pills on green · Meet / Work / + on white).
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
    <section className="shrink-0 pb-[env(safe-area-inset-bottom)]" aria-label="Filters">
      <FilterStrip filters={filters} onChange={onChange} />
      <div className="bg-green-area">
        <PillRow label={row1Label} items={data.row1} value={filters.row1} onChange={(row1) => onChange({ ...filters, row1 })} />
        <PillRow label={row2Label} items={data.row2} value={filters.row2} onChange={(row2) => onChange({ ...filters, row2 })} />
      </div>
      <div className="flex h-11">
        <div className="scrollbar-none flex min-w-0 flex-[62] items-center gap-1.5 overflow-x-auto bg-green-bar px-2.5">
          <button type="button" aria-label="Pick a date" title="Pick a date" aria-pressed={!!filters.date} onClick={onOpenDate} className="flex h-8 shrink-0 items-center gap-1 text-white">
            <CalendarDays size={20} strokeWidth={2.25} />
            {filters.date ? <span className="text-[11px] font-semibold">{fmtDate(parseDateKey(filters.date, data.tz), data.tz)}</span> : null}
          </button>
          <GreenPill active={filters.quick === "asc"} label="Sort ascending" onClick={() => quick("asc")}>
            Ascending
          </GreenPill>
          <GreenPill active={filters.quick === "tomorrow"} label="Tomorrow only" onClick={() => quick("tomorrow")}>
            tomorrow
          </GreenPill>
          <GreenPill active={filters.quick === "today"} label="Today only" onClick={() => quick("today")}>
            today
          </GreenPill>
        </div>
        <div className="flex flex-[38] items-center justify-evenly bg-white px-1">
          <button type="button" aria-label="Schedule a meeting" title="Meeting" onClick={() => onAdd("MEETING")} className="flex h-8 w-8 items-center justify-center">
            <MeetIcon size={22} />
          </button>
          <button type="button" onClick={() => onAdd("WORK")} className="no-select flex h-[22px] items-center rounded-full bg-[#E5E7EB] px-3 text-[11px] leading-none text-[#111]">
            Work
          </button>
          <button type="button" aria-label="Add task" onClick={() => onAdd("CHOOSE")} className="flex h-8 w-8 items-center justify-center text-[#111]">
            <Plus size={24} strokeWidth={2.75} />
          </button>
        </div>
      </div>
    </section>
  );
}
