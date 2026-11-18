"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { BarChip, BottomZone } from "@/components/ui/BottomZone";
import { formatINR } from "@/server/finance/money";
import type { ClientLedger } from "@/server/finance/queries";
import { fmtDay } from "@/components/finance/finance-ui";

const KIND: Record<ClientLedger["entries"][number]["kind"], { label: string; cls: string }> = {
  INVOICE: { label: "Invoice", cls: "bg-sky-100/70 text-sky-900" },
  PAYMENT: { label: "Payment", cls: "bg-green-100/70 text-green-800" },
  CREDIT_NOTE: { label: "Credit note", cls: "bg-rose-100/70 text-rose-900" },
};

/** /admin/payments/[clientId] — chronological statement with a running balance. */
export function ClientLedgerView({ ledger, tz, onHold }: { ledger: ClientLedger; tz: string; onHold: boolean }) {
  const router = useRouter();
  const t = ledger.totals;
  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 px-4 pb-4 pt-3 text-white backdrop-blur-xl">
        <Link href="/admin/payments" className="text-xs opacity-80">← Payments</Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-lg font-bold">{ledger.clientName}</h1>
          {onHold ? <span className="rounded-full bg-red-100/80 px-2 py-0.5 text-[10px] font-semibold text-red-700">Work on hold</span> : null}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            { label: "Invoiced", value: t.invoiced },
            { label: "Received", value: t.received },
            { label: "TDS + credits", value: t.tds + t.credited },
            { label: "Outstanding", value: t.outstanding, warn: t.outstanding > 0 },
          ].map((x) => (
            <div key={x.label} className="rounded-xl border border-white/60 bg-white/85 px-3 py-1.5 backdrop-blur-md">
              <div className="text-[10px] uppercase text-gray-600">{x.label}</div>
              <div className={`text-sm font-bold ${x.warn ? "text-amber-700" : "text-gray-900"}`}>{formatINR(x.value)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {ledger.entries.length === 0 ? <p className="px-4 py-10 text-center text-sm text-gray-500">No approved invoices yet.</p> : null}
        <ul className="divide-y divide-white/60 bg-white/55 backdrop-blur-md">
          {ledger.entries.map((e, i) => {
            const k = KIND[e.kind];
            return (
              <li key={`${e.ref}-${i}`}>
                <Link href={`/admin/invoices/${e.invoiceId}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold">{e.ref}</span>
                      <span className={`rounded-full border border-white/60 px-2 py-0.5 text-[10px] font-medium backdrop-blur-sm ${k.cls}`}>{k.label}</span>
                    </div>
                    <div className="truncate text-xs text-gray-500">{fmtDay(e.date, tz)}{e.description ? ` · ${e.description}` : ""}</div>
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    {e.debit > 0 ? <div className="text-gray-900">+{formatINR(e.debit)}</div> : <div className="text-green-700">−{formatINR(e.credit)}</div>}
                    <div className="text-[11px] text-gray-500">bal {formatINR(e.balance)}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <BottomZone
        left={
          <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push("/admin/payments"))} className="touch-target flex items-center gap-0.5 pl-1 text-[12px] font-medium text-white" aria-label="Back">
            <ChevronLeft size={16} /> Back
          </button>
        }
        right={<BarChip onClick={() => router.push(`/admin/invoices?new=1`)} label="New invoice">+ New invoice</BarChip>}
      />
    </div>
  );
}
