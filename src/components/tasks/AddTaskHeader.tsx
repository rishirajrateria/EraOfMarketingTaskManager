"use client";
import { fmtLoadHours, type PeriodLoads } from "@/components/tasks/add-task-helpers";

const TILES: { key: keyof PeriodLoads; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tom" },
  { key: "week", label: "Week" },
  { key: "month", label: "month" },
];

/** TOP CYAN AREA: four left-aligned load pills "<b>Today</b> - 5 Hours - <b>45</b>" for the selected assignees. */
export function AddTaskHeader({ loads }: { loads: PeriodLoads }) {
  return (
    <header className="flex min-h-[190px] shrink-0 flex-col gap-2 bg-[#22C3E6] p-3 text-[#111]" aria-label="Assignee load">
      {TILES.map((t) => (
        <div key={t.key} className="flex h-[34px] w-fit min-w-[196px] items-center rounded-md bg-[#B8E9F6] px-3 text-sm leading-none">
          <b>{t.label}</b>
          <span className="whitespace-pre">{` - ${fmtLoadHours(loads[t.key].minutes)} - `}</span>
          <b>{loads[t.key].count}</b>
        </div>
      ))}
    </header>
  );
}
