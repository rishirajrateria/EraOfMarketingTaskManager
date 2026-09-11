"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { MonthGrid } from "@/server/attendance/queries";
import { exportAttendanceCsv } from "@/server/attendance/actions";
import { btnSecondary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { clsx } from "@/lib/clsx";
import { STATUS_ORDER, STATUS_STYLE } from "@/components/attendance/status";
import { MarkAttendanceSheet, type MarkTarget } from "@/components/attendance/MarkAttendanceSheet";

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Monthly attendance grid. With `canMark` (HR/Admin) each cell opens the marking sheet; otherwise the
 * grid is read-only (staff viewing their own month).
 */
export function AttendanceGrid({
  grid,
  canMark,
  filterUsers,
  selectedUserId,
}: {
  grid: MonthGrid;
  /** HR/Admin: tapping a cell opens the marking sheet. */
  canMark: boolean;
  /** People selectable in the per-user filter (Admin/HR only). */
  filterUsers: { id: string; name: string }[];
  selectedUserId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<MarkTarget | null>(null);

  const href = (month: string, userId = selectedUserId) => `${pathname}?month=${month}${userId ? `&userId=${userId}` : ""}`;

  const download = () =>
    start(async () => {
      const r = await exportAttendanceCsv({ month: grid.month, userId: selectedUserId });
      if (!r.ok) return toast(r.error, "err");
      const blob = new Blob([r.data.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = r.data.filename;
      a.click();
      URL.revokeObjectURL(url);
    });

  return (
    <section className="mx-3 mt-3 rounded-xl bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <Link href={href(grid.prevMonth)} className="touch-target flex items-center px-2 text-lg" aria-label="Previous month">
          ‹
        </Link>
        <div className="text-sm font-semibold">{grid.label}</div>
        <Link href={href(grid.nextMonth)} className="touch-target flex items-center px-2 text-lg" aria-label="Next month">
          ›
        </Link>
      </div>
      {filterUsers.length > 0 ? (
        <div className="mt-2 flex items-center gap-2">
          <select
            className={inputCls}
            value={selectedUserId ?? ""}
            onChange={(e) => router.push(href(grid.month, e.target.value || undefined))}
            aria-label="Filter by person"
          >
            <option value="">Everyone</option>
            {filterUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <button className={btnSecondary} onClick={download} disabled={pending}>
            CSV
          </button>
        </div>
      ) : (
        <div className="mt-2 flex justify-end">
          <button className={btnSecondary} onClick={download} disabled={pending}>
            CSV
          </button>
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[10px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white pr-2 text-left text-xs font-medium text-gray-500">Person</th>
              {grid.days.map((d) => (
                <th key={d.key} className={clsx("min-w-6 text-center font-medium", d.working ? "text-gray-600" : "text-gray-400")}>
                  <div>{d.day}</div>
                  <div className="text-[9px]">{WEEKDAY[d.weekday]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.users.map((u) => (
              <tr key={u.id}>
                <td className="sticky left-0 whitespace-nowrap bg-white pr-2 text-xs">{u.name}</td>
                {grid.days.map((d) => {
                  const c = grid.cells[u.id]?.[d.key];
                  const style = c ? STATUS_STYLE[c.status] : null;
                  const title = c ? `${style?.label}${c.checkIn ? ` · in ${c.checkIn}` : ""}${c.checkOut ? ` · out ${c.checkOut}` : ""}${c.note ? ` · ${c.note}` : ""}` : d.key;
                  const cellCls = clsx(
                    "flex h-6 w-6 items-center justify-center rounded font-bold",
                    style ? style.cls : d.working ? "bg-gray-50 text-gray-300" : "bg-gray-200 text-gray-400",
                  );
                  return (
                    <td key={d.key} className="p-0">
                      {canMark ? (
                        <button
                          type="button"
                          title={title}
                          onClick={() => setTarget({ userId: u.id, userName: u.name, date: d.key, cell: c })}
                          className={clsx(cellCls, "cursor-pointer hover:ring-1 hover:ring-gray-400")}
                        >
                          {style?.letter ?? ""}
                        </button>
                      ) : (
                        <div title={title} className={cellCls} aria-label={title}>
                          {style?.letter ?? ""}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {grid.users.length === 0 ? (
              <tr>
                <td className="py-4 text-xs text-gray-400">No people to show.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-gray-500">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`rounded px-1 font-bold ${STATUS_STYLE[s].cls}`}>{STATUS_STYLE[s].letter}</span>
            {STATUS_STYLE[s].label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="rounded bg-gray-200 px-2 py-0.5" /> non-working
        </span>
      </div>
      {canMark && target ? <MarkAttendanceSheet key={`${target.userId}-${target.date}`} target={target} onClose={() => setTarget(null)} /> : null}
    </section>
  );
}
