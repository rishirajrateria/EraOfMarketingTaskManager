"use client";
import { clsx } from "@/lib/clsx";
import type { DashboardData, DashboardFilters } from "@/server/tasks/types";
import { datePillLabel, pillHours, pillText } from "@/components/dashboard/format";

/** 5 pills of 32px with 8px gaps — the column scrolls when a group has more. */
const COLUMN_PX = 5 * 32 + 4 * 8;

/**
 * Cyan pill area (SPEC §5.1): time-status pills in columns, no headers.
 * Admin: Team | Person | Client · Team Leader: Executive | Date | Client · Executive: Date | Client (right-aligned).
 * Every pill filters the list; tapping the active pill again clears it.
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
  const select = (id: string) => onChange({ ...filters, pill: filters.pill === id ? null : id });
  const twoCol = data.pills.length === 2;
  return (
    <section className="shrink-0 bg-cyan-area px-2.5 pb-2" aria-label="Time status">
      {topBar}
      <div className="mt-1.5 flex gap-3">
        {data.pills.map((g, i) => {
          const alignEnd = twoCol && i === 1;
          return (
            <div
              key={g.key}
              role="group"
              aria-label={g.label}
              className={clsx("scrollbar-none flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto", alignEnd ? "items-end" : "items-stretch")}
              style={{ height: COLUMN_PX }}
            >
              {g.items.length === 0 ? <span className="px-1 text-[12px] font-semibold text-white/70">—</span> : null}
              {g.items.map((it) => {
                const active = filters.pill === it.id;
                return (
                  <button
                    key={it.id}
                    type="button"
                    aria-pressed={active}
                    title={pillText(it.label, it.minutes)}
                    onClick={() => select(it.id)}
                    className={clsx(
                      "no-select flex h-8 shrink-0 items-center rounded-[6px] px-3 text-left text-[14px] font-bold leading-none text-[#111] transition",
                      twoCol ? "w-auto max-w-full" : "w-full",
                      active ? "bg-cyan-pill-active shadow-[inset_0_0_0_2px_#0E7490]" : "bg-cyan-pill",
                    )}
                  >
                    <span className="truncate">{datePillLabel(it.id, it.label)}</span>
                    <span className="shrink-0 whitespace-pre">- {pillHours(it.minutes)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
