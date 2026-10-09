"use client";
import { clsx } from "@/lib/clsx";
import type { DashboardData, DashboardFilters } from "@/server/tasks/types";
import { datePillLabel, pillHours, pillText, shortPillLabel } from "@/components/dashboard/format";

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
    <section className="shrink-0 bg-cyan-area px-3 pb-3 pt-[env(safe-area-inset-top)]" aria-label="Time status">
      {topBar}
      <div className="mt-1 flex gap-2">
        {data.pills.map((g, i) => {
          const alignEnd = twoCol && i === 1;
          return (
            <div
              key={g.key}
              role="group"
              aria-label={g.label}
              className={clsx("scrollbar-none flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto", alignEnd ? "items-end" : twoCol ? "items-start" : "items-stretch")}
              style={{ height: COLUMN_PX }}
            >
              {g.items.length === 0 ? <span className="px-1 text-[12px] font-semibold text-z1icon">—</span> : null}
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
                      "no-select flex h-8 shrink-0 items-center rounded-[10px] px-2.5 text-left text-[12.5px] font-bold leading-none transition",
                      twoCol ? "w-auto max-w-full" : "w-full",
                      active ? "bg-cyan-pill-active" : "bg-cyan-pill",
                    )}
                  >
                    <span className="truncate">{it.id.startsWith("date:") ? datePillLabel(it.id, it.label) : shortPillLabel(it.label)}</span>
                    <span className="shrink-0 whitespace-pre font-semibold opacity-85">- {pillHours(it.minutes)}</span>
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
