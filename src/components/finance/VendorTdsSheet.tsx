"use client";
import { Sheet } from "@/components/ui/Sheet";
import { formatINR } from "@/server/finance/money";
import type { VendorTdsSummary } from "@/server/finance/tds";

/** Per-payee totals for the financial year (ADR 0006): paid, TDS deducted, threshold status. */
export function VendorTdsSheet({ summary, open, onClose }: { summary: VendorTdsSummary; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={`TDS by payee · FY ${summary.fyKey}`}>
      <div className="px-4 py-3">
        <p className="mb-2 text-xs text-gray-500">Threshold {formatINR(summary.threshold)} per payee per financial year (resets every 1 April). Change it in Settings → TDS.</p>
        {summary.vendors.length === 0 ? <p className="py-6 text-center text-sm text-gray-500">No expenses with a vendor this financial year.</p> : null}
        <ul className="divide-y divide-white/60">
          {summary.vendors.map((v) => (
            <li key={v.vendor.toLowerCase()} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{v.vendor}</div>
                <div className="text-xs text-gray-500">
                  {v.expenses} expense{v.expenses === 1 ? "" : "s"} · TDS deducted {formatINR(v.tds)}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatINR(v.paid)}</div>
                <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${v.crossed ? (v.tds > 0 ? "bg-green-100/80 text-green-800" : "bg-amber-100/80 text-amber-800") : "bg-white/70 text-gray-600"}`}>
                  {v.crossed ? (v.tds > 0 ? "TDS applies · deducted" : "TDS applies · none deducted") : "Under threshold"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Sheet>
  );
}
