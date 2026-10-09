"use client";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Download } from "lucide-react";
import type { MonthGrid } from "@/server/attendance/queries";
import { exportAttendanceCsv } from "@/server/attendance/actions";
import { useToast } from "@/components/ui/Toast";
import { BarChip, BarIcon, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { PeriodNav, Screen, ScreenHeader } from "@/components/admin/AdminUi";
import { clsx } from "@/lib/clsx";
import { STATUS_ORDER, STATUS_STYLE } from "@/components/attendance/status";
import { MarkAttendanceSheet, type MarkTarget } from "@/components/attendance/MarkAttendanceSheet";

const WEEKDAY = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Monthly attendance screen. With `canMark` (HR/Admin) each cell opens the marking sheet; otherwise the
 * grid is read-only (staff viewing their own month). Month navigation, the person filter, CSV export and
 * "Request leave" live in the bottom zone (SPEC §5.4).
 */
export function AttendanceGrid({
  grid,
  canMark,
  filterUsers,
  selectedUserId,
  hint,
  isAdmin,
}: {
  grid: MonthGrid;
  /** HR/Admin: tapping a cell opens the marking sheet. */
  canMark: boolean;
  /** People selectable in the per-user filter (Admin/HR only). */
  filterUsers: { id: string; name: string }[];
  selectedUserId?: string;
  /** One-line explanation shown under the title. */
  hint: string;
  /** Shows the ☰ menu button in the bar. */
  isAdmin: boolean;
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

  const zone = (
    <BottomZone
      menu={isAdmin}
      rows={
        filterUsers.length > 0 ? (
          <ZoneRow label="Person">
            <ZonePill active={!selectedUserId} onClick={() => router.push(href(grid.month, undefined))}>
              Everyone
            </ZonePill>
            {filterUsers.map((u) => (
              <ZonePill key={u.id} active={selectedUserId === u.id} onClick={() => router.push(href(grid.month, selectedUserId === u.id ? undefined : u.id))}>
                {u.name}
              </ZonePill>
            ))}
          </ZoneRow>
        ) : undefined
      }
      left={<PeriodNav label={grid.label} prevLabel="Previous month" nextLabel="Next month" onPrev={() => router.push(href(grid.prevMonth))} onNext={() => router.push(href(grid.nextMonth))} />}
      right={
        <>
          <BarIcon tone="white" label={pending ? "Exporting CSV" : "Export CSV"} onClick={pending ? undefined : download}>
            <Download size={20} />
          </BarIcon>
          <BarChip label="Request leave" onClick={() => router.push("/leave")}>
            + Leave
          </BarChip>
        </>
      }
    />
  );

  return (
    <Screen header={<ScreenHeader title="Attendance" subtitle={`${grid.label} · ${hint}`} />} zone={zone}>
      <section className="glass mx-3 my-3 rounded-2xl p-3">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[10px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white/80 pr-2 text-left text-xs font-medium text-gray-600 backdrop-blur-md">Person</th>
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
                <td className="sticky left-0 whitespace-nowrap bg-white/80 pr-2 text-xs backdrop-blur-md">{u.name}</td>
                {grid.days.map((d) => {
                  const c = grid.cells[u.id]?.[d.key];
                  const style = c ? STATUS_STYLE[c.status] : null;
                  const title = c ? `${style?.label}${c.checkIn ? ` · in ${c.checkIn}` : ""}${c.checkOut ? ` · out ${c.checkOut}` : ""}${c.note ? ` · ${c.note}` : ""}` : d.key;
                  const cellCls = clsx(
                    "flex h-6 w-6 items-center justify-center rounded font-bold",
                    style ? style.cls : d.working ? "bg-white/50 text-gray-400" : "bg-gray-300/50 text-gray-500",
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
          <span className="rounded bg-gray-300/50 px-2 py-0.5" /> non-working
        </span>
      </div>
      {canMark && target ? <MarkAttendanceSheet key={`${target.userId}-${target.date}`} target={target} onClose={() => setTarget(null)} /> : null}
      </section>
    </Screen>
  );
}
