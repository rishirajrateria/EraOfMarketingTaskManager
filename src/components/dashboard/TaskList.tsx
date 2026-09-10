"use client";
import { useRef, useState } from "react";
import type { DashboardData, TaskRow as Row } from "@/server/tasks/types";
import { TaskRow, type RowHandlers } from "@/components/dashboard/TaskRow";

const PULL_THRESHOLD = 70;

/** Middle zone (SPEC §5.2): scrollable task list with pull-to-refresh (SPEC §14). */
export function TaskList({
  tasks,
  data,
  handlers,
  onRefresh,
  refreshing,
}: {
  tasks: Row[];
  data: DashboardData;
  handlers: RowHandlers;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [pull, setPull] = useState(0);

  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = ref.current && ref.current.scrollTop <= 0 ? e.touches[0]!.clientY : null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = e.touches[0]!.clientY - startY.current;
    setPull(Math.max(0, Math.min(dy, 120)));
  };
  const onTouchEnd = () => {
    if (pull > PULL_THRESHOLD) onRefresh();
    setPull(0);
    startY.current = null;
  };

  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {pull > 0 || refreshing ? (
        <div className="flex items-center justify-center overflow-hidden text-[11px] text-gray-500 transition-[height]" style={{ height: refreshing ? 28 : Math.round(pull * 0.5) }}>
          {refreshing ? "Refreshing…" : pull > PULL_THRESHOLD ? "Release to refresh" : "Pull to refresh"}
        </div>
      ) : null}
      {tasks.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-gray-400">No tasks match the current filters.</p>
      ) : (
        <ul>
          {tasks.map((t) => (
            <TaskRow key={t.id} t={t} data={data} h={handlers} />
          ))}
        </ul>
      )}
    </div>
  );
}
