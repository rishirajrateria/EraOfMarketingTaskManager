"use client";
import { useMemo } from "react";
import { clsx } from "@/lib/clsx";
import type { DashboardData, DashboardFilters } from "@/server/tasks/types";
import { hoursText, summaryGroups } from "@/components/dashboard/summary";

/**
 * Top summary (prototype `.sumsec2` / `.sch`, ADR 0015) — the most compact form: under the top bar ONE line per group:
 * a 54px muted label and one sideways-scrolling row of content-sized 30px chips "Social 11.8h (8)" in the add-task
 * capacity cell colours. The old "OPEN HOURS · <filters>" caption is gone (ADR 0016 addendum); the active filters show
 * on the minimised filter tray instead.
 * Admin: Teams (or "<Team>·people") + Clients · Team Leader: People + Clients · Executive: Days + Clients.
 * The numbers follow the bottom filters; tapping a chip filters the list (tap again to clear).
 */
export function TimeStatus({
  data,
  filters,
  onChange,
  topBar,
}: {
  data: DashboardData;
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  topBar: React.ReactNode;
}) {
  const groups = useMemo(() => summaryGroups(data, filters), [data, filters]);
  const select = (id: string) => onChange({ ...filters, pill: filters.pill === id ? null : id });
  return (
    <section className="shrink-0 bg-cyan-area px-2.5 pb-2.5 pt-[env(safe-area-inset-top)]" aria-label="Open hours">
      {topBar}
      <div className="mt-1.5 space-y-1.5">
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.label} className="flex items-center gap-2">
            <span className="w-[54px] shrink-0 truncate text-[10px] font-extrabold uppercase tracking-[.07em] text-z1ink opacity-75" title={g.label}>
              {g.label.replace(" · ", "·")}
            </span>
            <div className="scrollbar-none flex min-w-0 flex-1 gap-[5px] overflow-x-auto pr-0.5">
              {g.items.length === 0 ? <span className="py-1.5 text-[12px] text-z1ink opacity-60">Nothing open</span> : null}
              {g.items.map((it) => {
                const active = filters.pill === it.id;
                const count = it.count ?? 0;
                return (
                  <button
                    key={it.id}
                    type="button"
                    aria-pressed={active}
                    title={`${it.label}: ${hoursText(it.minutes)} open in ${count} task${count === 1 ? "" : "s"}`}
                    onClick={() => select(it.id)}
                    className={clsx("no-select inline-flex h-[30px] shrink-0 items-center gap-[5px] whitespace-nowrap rounded-[10px] px-[9px] text-[12.5px] tabular-nums transition", active ? "bg-cyan-pill-active" : "bg-cyan-pill")}
                  >
                    <span className="font-semibold">{it.label}</span>
                    <b className="font-extrabold">{hoursText(it.minutes)}</b>
                    <small className="rounded-full bg-white/25 px-[5px] py-px text-[10px] font-bold opacity-75">{count}</small>
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
