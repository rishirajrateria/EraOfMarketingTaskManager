"use client";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarRange } from "lucide-react";
import type { HourlyBreakdown, InventoryResult } from "@/server/inventory/queries";
import { INVENTORY_VIEWS, shiftRange, stripGranularity, type InventoryView } from "@/server/inventory/ranges";
import { Field, btnPrimary, inputCls } from "@/components/ui/Field";
import { SheetButtons } from "@/components/ui/CloseX";
import { Sheet } from "@/components/ui/Sheet";
import { BarChip, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { PeriodNav, Screen } from "@/components/admin/AdminUi";
import { InventoryTable, RemainingStrip, hrs } from "@/components/inventory/InventoryTable";
import { HourlyGrid } from "@/components/inventory/HourlyGrid";

export type { InventoryView } from "@/server/inventory/ranges";

export type InventoryRangeProps = { from: string; to: string; label: string };

/**
 * Admin inventory screen (SPEC §9.3 / §11.6). Day view shows the hourly breakdown; Week / Month / Quarter /
 * Year / Custom show the per-person table, team totals and the per-period "remaining" strip.
 * View pills, team pills, prev/next and the custom-range sheet live in the bottom zone (SPEC §5.4).
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
  const [rangeSheet, setRangeSheet] = useState(false);

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

  const zone = (
    <BottomZone
      menu
      rows={
        <>
          <ZoneRow label="View">
            {INVENTORY_VIEWS.map((v) => (
              <ZonePill key={v.id} active={view === v.id} onClick={() => router.push(href({ view: v.id }))}>
                {v.label}
              </ZonePill>
            ))}
          </ZoneRow>
          <ZoneRow label="Team">
            <ZonePill active={!teamId} onClick={() => router.push(href({ teamId: undefined }))}>
              All teams
            </ZonePill>
            {teams.map((t) => (
              <ZonePill key={t.id} active={teamId === t.id} onClick={() => router.push(href({ teamId: teamId === t.id ? undefined : t.id }))}>
                {t.name}
              </ZonePill>
            ))}
          </ZoneRow>
        </>
      }
      left={<PeriodNav label={range.label} prevLabel={`Previous ${view}`} nextLabel={`Next ${view}`} onPrev={() => router.push(href(prev))} onNext={() => router.push(href(next))} />}
      right={
        view === "custom" ? (
          <BarChip label="Pick custom dates" onClick={() => setRangeSheet(true)}>
            <CalendarRange size={14} className="mr-1" />
            Dates
          </BarChip>
        ) : undefined
      }
    />
  );

  return (
    <Screen
      header={
        <div className="bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 px-3 pb-3 pt-2 text-white backdrop-blur-xl">
          <h1 className="text-base font-semibold">Inventory</h1>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <Stat label="Capacity" value={hrs(inv.total.capacityMinutes)} />
            <Stat label="Assigned" value={hrs(inv.total.assignedMinutes)} />
            <Stat label="Sellable" value={hrs(inv.total.sellableMinutes)} />
          </div>
          <div className="mt-1 text-center text-[10px] text-white/70">
            {inv.days[0]}
            {inv.days.length > 1 ? ` → ${inv.days[inv.days.length - 1]}` : ""} · hours
          </div>
        </div>
      }
      zone={zone}
      className="pb-3"
    >
      {view === "day" && hourly ? (
        <HourlyGrid hourly={hourly} />
      ) : (
        <>
          <RemainingStrip dayTotals={inv.dayTotals} by={stripGranularity(view, inv.days.length)} />
          <InventoryTable inv={inv} />
        </>
      )}
      <Sheet open={rangeSheet} onClose={() => setRangeSheet(false)} title="Custom range">
        <form
          className="space-y-3 px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            setRangeSheet(false);
            router.push(href({ view: "custom", from: cFrom, to: cTo }));
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <input type="date" className={inputCls} value={cFrom} onChange={(e) => setCFrom(e.target.value)} aria-label="From" />
            </Field>
            <Field label="To">
              <input type="date" className={inputCls} value={cTo} min={cFrom} onChange={(e) => setCTo(e.target.value)} aria-label="To" />
            </Field>
          </div>
          <SheetButtons>
            <button type="submit" className={btnPrimary}>
              Go
            </button>
          </SheetButtons>
        </form>
      </Sheet>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/30 bg-white/20 py-2 backdrop-blur-md">
      <div className="text-lg font-bold leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-white/80">{label}</div>
    </div>
  );
}
