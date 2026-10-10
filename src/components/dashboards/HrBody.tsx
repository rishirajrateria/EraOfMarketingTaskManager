"use client";
import Link from "next/link";
import { clsx } from "@/lib/clsx";
import type { HrDash, TodayStatus } from "@/server/dashboards/hr";
import { Card, Empty, Tile, Tiles } from "@/components/dashboards/charts";
import { hrs, loadTone } from "@/components/dashboards/format";

/** HR view (prototype `hrBody`): today's attendance, free hours, and each person's booked share of capacity. */
const STATUS: Record<TodayStatus, { label: string; cls: string }> = {
  PRESENT: { label: "Present", cls: "text-emerald-700 dark:text-emerald-300" },
  HALF_DAY: { label: "Half day", cls: "text-amber-700 dark:text-amber-300" },
  LEAVE: { label: "On leave", cls: "text-red-700 dark:text-red-300" },
  ABSENT: { label: "Absent", cls: "text-red-700 dark:text-red-300" },
  HOLIDAY: { label: "Holiday", cls: "text-muted" },
  NONE: { label: "Not marked", cls: "text-muted" },
};
const BAR = { red: "bg-[#dc2626]", amber: "bg-[#f59e0b]", ok: "bg-s-inc" } as const;
const h0 = (min: number) => `${Math.round(min / 60)}h`;

export function HrBody({ data: d }: { data: HrDash }) {
  return (
    <>
      <Tiles>
        <Tile label="Present" value={`${d.presentToday} / ${d.staff}`} sub="today" />
        <Tile label="On leave" value={String(d.onLeaveToday)} sub="today" />
        <Tile label="Free to assign" value={h0(d.freeMin)} sub={`${h0(d.bookedMin)} of ${h0(d.capacityMin)} booked`} />
      </Tiles>
      <Card title="Team inventory · booked of capacity">
        {d.people.length === 0 ? <Empty>No team leaders or executives in this team</Empty> : null}
        <ul className="mt-1">
          {d.people.map((p) => {
            const st = STATUS[p.today];
            const tone = loadTone(p.pct);
            return (
              <li key={p.userId} className="border-b border-line last:border-b-0">
                <Link
                  href="/admin/inventory"
                  className="block py-2.5"
                  aria-label={`${p.name}, ${st.label} today, ${hrs(p.bookedMin)} of ${hrs(p.capacityMin)} booked (${p.pct}%), ${hrs(p.freeMin)} free${p.daysOff ? `, ${p.daysOff} days off` : ""}. Open inventory`}
                >
                  <span className="flex items-center justify-between gap-2 text-[13px]">
                    <b className="min-w-0 truncate font-semibold">{p.name}</b>
                    <span className={clsx("inline-flex h-[22px] shrink-0 items-center rounded-full border border-hair bg-chip px-2 text-[11px] font-semibold", st.cls)}>{st.label}</span>
                  </span>
                  <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-chip">
                    <i className={clsx("block h-full rounded-r-[4px]", BAR[tone])} style={{ width: `${Math.max(2, p.pct)}%` }} />
                  </span>
                  <small className="mt-1 block truncate text-[11px] text-muted">
                    {[p.teamName, `${hrs(p.bookedMin)} of ${h0(p.capacityMin)} booked`, `${h0(p.freeMin)} free`, p.daysOff ? `${p.daysOff} day${p.daysOff === 1 ? "" : "s"} off` : null].filter(Boolean).join(" · ")}
                  </small>
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </>
  );
}
