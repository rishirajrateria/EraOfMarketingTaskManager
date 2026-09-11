"use client";
import type { HourlyBreakdown, HourlyRow } from "@/server/inventory/queries";
import { minutesLabel, type HourCell, type HourCellKind } from "@/server/inventory/hourly";
import { clsx } from "@/lib/clsx";
import { hrs } from "@/components/inventory/InventoryTable";

const KIND_STYLE: Record<HourCellKind, { cls: string; label: string }> = {
  free: { cls: "bg-green-100", label: "Free" },
  assigned: { cls: "bg-blue-200", label: "Assigned" },
  lunch: { cls: "bg-gray-200", label: "Lunch" },
  off: { cls: "bg-gray-300", label: "Leave / holiday / absent" },
};

const STATUS_LABEL: Record<HourlyRow["status"], string> = {
  PRESENT: "",
  HALF_DAY: "Half day",
  ABSENT: "Absent",
  LEAVE: "Leave",
  HOLIDAY: "Holiday",
  OFF: "Non-working day",
};

function cellTitle(cell: HourCell, lunch: { start: number; end: number }): string {
  const slot = `${minutesLabel(cell.start)}–${minutesLabel(cell.start + 60)}`;
  if (cell.kind === "assigned") return `${slot}: ${cell.tasks.map((t) => (t.type === "MEETING" ? `${t.title} (meeting)` : t.title)).join(", ")}`;
  if (cell.kind === "lunch") return `${slot}: lunch ${minutesLabel(lunch.start)}–${minutesLabel(lunch.end)}`;
  return `${slot}: ${KIND_STYLE[cell.kind].label.toLowerCase()}`;
}

/** Day view: one row per person, one cell per working hour, plus the day's capacity / assigned / sellable. */
export function HourlyGrid({ hourly }: { hourly: HourlyBreakdown }) {
  return (
    <section className="mx-3 mt-3 rounded-xl bg-white p-3 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Hour by hour · {hourly.date}</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[10px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white pr-2 text-left text-xs font-medium text-gray-500">Person</th>
              {hourly.hours.map((h) => (
                <th key={h} className="min-w-7 text-center font-medium text-gray-500">
                  {String(Math.floor(h / 60)).padStart(2, "0")}
                </th>
              ))}
              <th className="pl-2 text-right font-medium text-gray-500">Cap</th>
              <th className="text-right font-medium text-gray-500">Asg</th>
              <th className="text-right font-medium text-gray-500">Sell</th>
            </tr>
          </thead>
          <tbody>
            {hourly.rows.map((r) => (
              <tr key={r.userId}>
                <td className="sticky left-0 whitespace-nowrap bg-white pr-2 text-xs">
                  {r.name}
                  {STATUS_LABEL[r.status] ? <span className="ml-1 text-[9px] text-gray-400">{STATUS_LABEL[r.status]}</span> : null}
                </td>
                {r.cells.map((c) => (
                  <td key={c.start} className="p-0">
                    <div
                      title={cellTitle(c, hourly.lunch)}
                      aria-label={cellTitle(c, hourly.lunch)}
                      className={clsx("flex h-7 w-7 items-center justify-center rounded text-[9px] font-semibold text-gray-700", KIND_STYLE[c.kind].cls)}
                    >
                      {c.kind === "assigned" && c.tasks.length > 1 ? c.tasks.length : ""}
                    </div>
                  </td>
                ))}
                <td className="pl-2 text-right text-xs">{hrs(r.capacityMinutes)}</td>
                <td className="text-right text-xs">{hrs(r.assignedMinutes)}</td>
                <td className={clsx("text-right text-xs font-semibold", r.sellableMinutes === 0 && r.capacityMinutes > 0 && "text-red-600")}>{hrs(r.sellableMinutes)}</td>
              </tr>
            ))}
            {hourly.rows.length === 0 ? (
              <tr>
                <td className="py-4 text-xs text-gray-400">No people in this selection.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-gray-500">
        {(Object.keys(KIND_STYLE) as HourCellKind[]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className={clsx("inline-block h-3 w-3 rounded", KIND_STYLE[k].cls)} />
            {KIND_STYLE[k].label}
          </span>
        ))}
        <span className="ml-auto">
          {minutesLabel(hourly.hours[0] ?? 0)}–{minutesLabel((hourly.hours[hourly.hours.length - 1] ?? 0) + 60)} · hover a cell for the task
        </span>
      </div>
    </section>
  );
}
