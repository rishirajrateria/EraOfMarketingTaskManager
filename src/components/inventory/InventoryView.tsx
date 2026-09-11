"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { HourlyBreakdown, InventoryResult } from "@/server/inventory/queries";
import { INVENTORY_VIEWS, shiftRange, stripGranularity, type InventoryView } from "@/server/inventory/ranges";
import { btnSecondary, inputCls } from "@/components/ui/Field";
import { Pill } from "@/components/ui/Pill";
import { clsx } from "@/lib/clsx";
import { InventoryTable, RemainingStrip, hrs } from "@/components/inventory/InventoryTable";
import { HourlyGrid } from "@/components/inventory/HourlyGrid";

export type { InventoryView } from "@/server/inventory/ranges";

export type InventoryRangeProps = { from: string; to: string; label: string };

/**
 * Admin inventory screen (SPEC §9.3 / §11.6). Day view shows the hourly breakdown; Week / Month / Quarter /
 * Year / Custom show the per-person table, team totals and the per-period "remaining" strip.
 */
export function InventoryPanel({
  inv,
  view,
  range,
  teams,
  teamId,
  hourly,
}: {
  inv: InventoryResult;
  view: InventoryView;
  range: InventoryRangeProps;
  teams: { id: string; name: string }[];
  teamId?: string;
  hourly?: HourlyBreakdown | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [cFrom, setCFrom] = useState(range.from);
  const [cTo, setCTo] = useState(range.to);

  const href = (q: { view?: InventoryView; from?: string; to?: string; teamId?: string | undefined }) => {
    const v = q.view ?? view;
    const p = new URLSearchParams();
    p.set("view", v);
    const t = "teamId" in q ? q.teamId : teamId;
    if (t) p.set("teamId", t);
    if (v === "custom") {
      p.set("from", q.from ?? cFrom);
      p.set("to", q.to ?? cTo);
    } else {
      // Switching views keeps the current anchor day so Day → Week → Month stay around the same date.
      p.set("date", q.from ?? range.from);
    }
    return `${pathname}?${p.toString()}`;
  };
  const prev = shiftRange(view, range, -1);
  const next = shiftRange(view, range, 1);

  return (
    <div className="pb-6">
      <div className="bg-brand-blue px-3 pb-3 pt-2 text-white">
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {INVENTORY_VIEWS.map((v) => (
            <Link key={v.id} href={href({ view: v.id })}>
              <Pill active={view === v.id}>{v.label}</Pill>
            </Link>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <Link href={href(prev)} className="touch-target flex items-center px-2 text-lg" aria-label={`Previous ${view}`}>
            ‹
          </Link>
          <div className="text-sm font-semibold">{range.label}</div>
          <Link href={href(next)} className="touch-target flex items-center px-2 text-lg" aria-label={`Next ${view}`}>
            ›
          </Link>
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
          {inv.days[0]}
          {inv.days.length > 1 ? ` → ${inv.days[inv.days.length - 1]}` : ""} · hours
        </div>
      </div>

      {view === "day" && hourly ? (
        <HourlyGrid hourly={hourly} />
      ) : (
        <>
          <RemainingStrip dayTotals={inv.dayTotals} by={stripGranularity(view, inv.days.length)} />
          <InventoryTable inv={inv} />
        </>
      )}
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
