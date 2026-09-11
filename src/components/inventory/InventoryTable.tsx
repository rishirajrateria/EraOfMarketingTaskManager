"use client";
import type { DayTotals, InventoryResult } from "@/server/inventory/queries";
import { bucketByPeriod, type StripGranularity } from "@/server/inventory/ranges";
import { sumTotals } from "@/server/inventory/compute";
import { clsx } from "@/lib/clsx";

export const hrs = (min: number) => (Math.round((min / 60) * 10) / 10).toString();

/**
 * "Remaining after current assignments" strip: one bar per day, or per week / month for long ranges
 * (Quarter, Year) so it stays readable.
 */
export function RemainingStrip({ dayTotals, by }: { dayTotals: DayTotals[]; by: StripGranularity }) {
  const buckets = bucketByPeriod(dayTotals, by).map((b) => ({ ...b, ...sumTotals(b.items) }));
  const unit = by === "day" ? "day" : by === "week" ? "week" : "month";
  return (
    <section className="mx-3 mt-3 rounded-xl bg-white p-3 shadow-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Remaining after current assignments{by !== "day" ? ` · per ${unit}` : ""}
      </h2>
      <div className="scrollbar-none mt-2 flex gap-1 overflow-x-auto">
        {buckets.map((b) => {
          const pct = b.capacityMinutes ? Math.min(100, Math.round((b.assignedMinutes / b.capacityMinutes) * 100)) : 0;
          const span = b.from === b.to ? b.from : `${b.from} → ${b.to}`;
          return (
            <div key={b.key} className="flex w-11 shrink-0 flex-col items-center" title={`${span}: ${hrs(b.sellableMinutes)}h sellable of ${hrs(b.capacityMinutes)}h`}>
              <div className="flex h-14 w-6 items-end rounded bg-gray-100">
                <div
                  className={clsx("w-full rounded", b.capacityMinutes === 0 ? "bg-gray-300" : pct >= 100 ? "bg-red-400" : "bg-brand-green")}
                  style={{ height: `${b.capacityMinutes ? 100 - pct : 100}%` }}
                />
              </div>
              <div className="mt-1 text-[10px] font-semibold">{hrs(b.sellableMinutes)}</div>
              <div className="whitespace-nowrap text-[9px] text-gray-400">{b.label}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Per-person table grouped by team with team subtotals and a grand total. */
export function InventoryTable({ inv }: { inv: InventoryResult }) {
  return (
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
