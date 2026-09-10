"use client";
import { clsx } from "@/lib/clsx";
import { fmtHoursPill } from "@/lib/time";
import type { DashboardData, DashboardFilters } from "@/server/tasks/types";
import { FilterStrip } from "@/components/dashboard/FilterStrip";

/**
 * Top blue area (SPEC §5.1): filter strip + "time status" pill columns.
 * Admin: Team / Person / Client · Team Leader: Executive / Date / Client · Executive: Date / Client.
 * Every pill filters the list; tapping the active pill again clears it.
 */
export function TimeStatus({
  data,
  filters,
  onChange,
}: {
  data: DashboardData;
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
}) {
  const select = (id: string) => onChange({ ...filters, pill: filters.pill === id ? null : id });
  return (
    <section className="bg-brand-blue px-3 pb-3 pt-2 text-white" aria-label="Time status">
      <FilterStrip filters={filters} onChange={onChange} />
      <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto">
        {data.pills.map((g) => (
          <div key={g.key} className="min-w-[31%] flex-1 shrink-0">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/75">{g.label}</div>
            <div className="scrollbar-none flex max-h-[7.25rem] flex-col gap-1 overflow-y-auto pr-0.5">
              {g.items.length === 0 ? <span className="text-[11px] text-white/60">—</span> : null}
              {g.items.map((it) => {
                const active = filters.pill === it.id;
                return (
                  <button
                    key={it.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => select(it.id)}
                    className={clsx(
                      "no-select flex min-h-7 w-full items-center justify-between gap-1 rounded-full px-2.5 py-1 text-left text-[11px] font-medium leading-4 transition",
                      active ? "bg-white text-gray-900 shadow" : "bg-white/20 text-white hover:bg-white/30",
                    )}
                  >
                    <span className="truncate">{it.label}</span>
                    <span className="shrink-0 whitespace-nowrap font-semibold">{fmtHoursPill(it.minutes)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
