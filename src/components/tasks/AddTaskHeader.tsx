"use client";
import { clsx } from "@/lib/clsx";
import { fmtShortHours, type PeriodLoads } from "@/components/tasks/add-task-helpers";

const TILES: { key: keyof PeriodLoads; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tom" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

/**
 * TOP CYAN STRIP (owner's revision): capacity of the selected team — one compact row of four cells, each "TODAY ·
 * 13h left · 2h booked". Hidden (collapsed) until a team is known, so the add sheet is full-screen before that;
 * collapses / expands gently (no animation with prefers-reduced-motion).
 */
export function AddTaskHeader({ loads, teamName }: { loads: PeriodLoads; teamName: string | null }) {
  const visible = !!teamName;
  return (
    <header
      aria-label={teamName ? `${teamName} capacity: hours left and booked` : undefined}
      aria-hidden={!visible}
      className={clsx(
        "grid shrink-0 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
        visible ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
      style={visible ? undefined : { paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="bg-cyan-area px-2.5 pb-2 pt-[calc(8px+env(safe-area-inset-top))]">
          <div className="grid grid-cols-4 gap-1.5">
            {TILES.map((t) => {
              const l = loads[t.key];
              return (
                <div
                  key={t.key}
                  title={`${teamName ?? ""} · ${t.label}: ${fmtShortHours(l.leftMinutes)} left, ${fmtShortHours(l.bookedMinutes)} booked (${l.count} task${l.count === 1 ? "" : "s"})`}
                  className="bg-cyan-pill min-w-0 rounded-xl px-2 py-[5px] leading-none"
                >
                  <div className="truncate text-[9.5px] font-bold uppercase tracking-[.08em] opacity-70">{t.label}</div>
                  <div className="mt-[3px] truncate text-[13px] font-bold tracking-[-.01em]">
                    {fmtShortHours(l.leftMinutes)} <span className="text-[10.5px] font-semibold">left</span>
                  </div>
                  <div className="mt-[2px] truncate text-[10.5px] opacity-75">{fmtShortHours(l.bookedMinutes)} booked</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}
