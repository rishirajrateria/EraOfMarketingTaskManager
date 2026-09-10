"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { InventoryResult } from "@/server/inventory/queries";
import { btnSecondary, inputCls } from "@/components/ui/Field";
import { Pill } from "@/components/ui/Pill";
import { clsx } from "@/lib/clsx";

export type InventoryView = "today" | "week" | "month" | "custom";
const VIEWS: { id: InventoryView; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "custom", label: "Custom" },
];

const hrs = (min: number) => (Math.round((min / 60) * 10) / 10).toString();

export function InventoryPanel({
  inv,
  view,
  from,
  to,
  teams,
  teamId,
}: {
  inv: InventoryResult;
  view: InventoryView;
  from: string;
  to: string;
  teams: { id: string; name: string }[];
  teamId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [cFrom, setCFrom] = useState(from);
  const [cTo, setCTo] = useState(to);

  const href = (q: { view?: InventoryView; from?: string; to?: string; teamId?: string | undefined }) => {
    const p = new URLSearchParams();
    p.set("view", q.view ?? view);
    const t = "teamId" in q ? q.teamId : teamId;
    if (t) p.set("teamId", t);
    if ((q.view ?? view) === "custom") {
      p.set("from", q.from ?? cFrom);
      p.set("to", q.to ?? cTo);
    }
    return `${pathname}?${p.toString()}`;
  };

  return (
    <div className="pb-6">
      <div className="bg-brand-blue px-3 pb-3 pt-2 text-white">
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {VIEWS.map((v) => (
            <Link key={v.id} href={href({ view: v.id })}>
              <Pill active={view === v.id}>{v.label}</Pill>
            </Link>
          ))}
        </div>
        {view === "custom" ? (
          <div className="mt-2 flex items-center gap-2">
            <input type="date" className={clsx(inputCls, "text-gray-900")} value={cFrom} onChange={(e) => setCFrom(e.target.value)} aria-label="From" />
            <input type="date" className={clsx(inputCls, "text-gray-900")} value={cTo} min={cFrom} onChange={(e) => setCTo(e.target.value)} aria-label="To" />
            <button className={btnSecondary} onClick={() => router.push(href({ from: cFrom, to: cTo }))}>
              Go
            </button>
          </div>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <select className={clsx(inputCls, "text-gray-900")} value={teamId ?? ""} onChange={(e) => router.push(href({ teamId: e.target.value || undefined }))} aria-label="Team">
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat label="Capacity" value={hrs(inv.total.capacityMinutes)} />
          <Stat label="Assigned" value={hrs(inv.total.assignedMinutes)} />
          <Stat label="Sellable" value={hrs(inv.total.sellableMinutes)} />
        </div>
        <div className="mt-1 text-center text-[10px] text-white/70">
          {inv.days[0]} → {inv.days[inv.days.length - 1]} · hours
        </div>
      </div>

      <section className="mx-3 mt-3 rounded-xl bg-white p-3 shadow-sm">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Remaining after current assignments</h2>
        <div className="scrollbar-none mt-2 flex gap-1 overflow-x-auto">
          {inv.dayTotals.map((d) => {
            const pct = d.capacityMinutes ? Math.min(100, Math.round((d.assignedMinutes / d.capacityMinutes) * 100)) : 0;
            return (
              <div key={d.date} className="flex w-11 shrink-0 flex-col items-center" title={`${d.date}: ${hrs(d.sellableMinutes)}h sellable of ${hrs(d.capacityMinutes)}h`}>
                <div className="flex h-14 w-6 items-end rounded bg-gray-100">
                  <div className={clsx("w-full rounded", d.capacityMinutes === 0 ? "bg-gray-300" : pct >= 100 ? "bg-red-400" : "bg-brand-green")} style={{ height: `${d.capacityMinutes ? 100 - pct : 100}%` }} />
                </div>
                <div className="mt-1 text-[10px] font-semibold">{hrs(d.sellableMinutes)}</div>
                <div className="text-[9px] text-gray-400">{d.date.slice(8)}/{d.date.slice(5, 7)}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="mx-3 mt-3 overflow-x-auto rounded-xl bg-white p-3 shadow-sm">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-gray-500">
              <th className="py-1">Person</th>
              <th className="py-1 text-right">Cap</th>
              <th className="py-1 text-right">Assigned</th>
              <th className="py-1 text-right">Sellable</th>
            </tr>
          </thead>
          <tbody>
            {inv.teams.map((t) => (
              <TeamRows key={t.teamId ?? "none"} team={t} users={inv.users.filter((u) => u.teamId === t.teamId)} />
            ))}
            {inv.users.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-center text-gray-400">
                  No people in this selection.
                </td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold">
              <td className="py-1.5">Total</td>
              <td className="py-1.5 text-right">{hrs(inv.total.capacityMinutes)}</td>
              <td className="py-1.5 text-right">{hrs(inv.total.assignedMinutes)}</td>
              <td className="py-1.5 text-right">{hrs(inv.total.sellableMinutes)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/15 py-2">
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-white/80">{label}</div>
    </div>
  );
}

function TeamRows({ team, users }: { team: InventoryResult["teams"][number]; users: InventoryResult["users"] }) {
  return (
    <>
      <tr className="bg-gray-50 font-semibold">
        <td className="py-1">{team.teamName}</td>
        <td className="py-1 text-right">{hrs(team.capacityMinutes)}</td>
        <td className="py-1 text-right">{hrs(team.assignedMinutes)}</td>
        <td className="py-1 text-right">{hrs(team.sellableMinutes)}</td>
      </tr>
      {users.map((u) => (
        <tr key={u.userId} className="border-t border-gray-100">
          <td className="py-1 pl-3">{u.name}</td>
          <td className="py-1 text-right">{hrs(u.capacityMinutes)}</td>
          <td className="py-1 text-right">{hrs(u.assignedMinutes)}</td>
          <td className={clsx("py-1 text-right", u.sellableMinutes === 0 && u.capacityMinutes > 0 && "text-red-600")}>{hrs(u.sellableMinutes)}</td>
        </tr>
      ))}
    </>
  );
}
