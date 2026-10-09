"use client";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FilePlus, Receipt } from "lucide-react";
import { BarChip, BarIcon, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { formatINR } from "@/server/finance/money";
import type { AwaitingRow, PaymentsDashboard } from "@/server/finance/queries";
import { AwaitingList, ClientGroups, OutstandingBars, ReceivedBlock, UpcomingList } from "@/components/finance/PaymentsSections";
import { METHOD_LABEL, PAYMENT_METHODS, monthLabel, shiftMonthKey, type PaymentMethod } from "@/components/finance/finance-ui";

type Props = { data: PaymentsDashboard; awaiting: AwaitingRow[]; method: PaymentMethod | null; tz: string };

/** /admin/payments — tiles, approval queue, due soon / overdue by client, upcoming, outstanding bars, received this month. */
export function PaymentsDashboardView({ data, awaiting, method, tz }: Props) {
  const router = useRouter();
  const go = (next: { month?: string; method?: PaymentMethod | null }) => {
    const p = new URLSearchParams();
    p.set("month", next.month ?? data.month);
    const m = next.method === undefined ? method : next.method;
    if (m) p.set("method", m);
    router.push(`/admin/payments?${p.toString()}`);
  };
  const t = data.tiles;
  const tiles = [
    { label: "Outstanding", value: formatINR(t.outstanding), cls: "text-amber-700" },
    { label: "Overdue", value: formatINR(t.overdue), cls: t.overdue > 0 ? "text-red-700" : "text-gray-900" },
    { label: `Received · ${monthLabel(data.month)}`, value: formatINR(t.receivedThisMonth), cls: "text-brand-green" },
    { label: "Awaiting approval", value: `${t.awaitingApprovalCount} · ${formatINR(t.awaitingApproval)}`, cls: t.awaitingApprovalCount > 0 ? "text-amber-700" : "text-gray-900" },
  ];
  return (
    <div className="flex flex-1 flex-col">
      <div className="grid grid-cols-2 gap-2 bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 p-3 text-white backdrop-blur-xl">
        {tiles.map((x) => (
          <div key={x.label} className="rounded-xl border border-white/60 bg-white/85 px-3 py-2 backdrop-blur-md">
            <div className="truncate text-[10px] uppercase text-gray-600">{x.label}</div>
            <div className={`truncate text-base font-bold ${x.cls}`}>{x.value}</div>
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3 pt-3">
        <AwaitingList rows={awaiting} tz={tz} />
        <ClientGroups title="Overdue" groups={data.overdue} tz={tz} tone="red" />
        <ClientGroups title="Due in 7 days" groups={data.dueSoon} tz={tz} tone="amber" />
        <UpcomingList upcoming={data.upcoming} tz={tz} />
        <OutstandingBars rows={data.outstandingByClient} />
        <ReceivedBlock d={data} tz={tz} monthName={monthLabel(data.month)} />
      </div>
      <BottomZone
        rows={
          <>
            <ZoneRow label="Month">
              <ZonePill onClick={() => go({ month: shiftMonthKey(data.month, -1) })} label="Previous month"><ChevronLeft size={12} /></ZonePill>
              <ZonePill active>{monthLabel(data.month)}</ZonePill>
              <ZonePill onClick={() => go({ month: shiftMonthKey(data.month, 1) })} label="Next month"><ChevronRight size={12} /></ZonePill>
            </ZoneRow>
            <ZoneRow label="Payment method">
              <ZonePill active={!method} onClick={() => go({ method: null })}>All</ZonePill>
              {PAYMENT_METHODS.filter((m) => m !== "OTHER").map((m) => (
                <ZonePill key={m} active={method === m} onClick={() => go({ method: m })}>{METHOD_LABEL[m]}</ZonePill>
              ))}
            </ZoneRow>
          </>
        }
        left={<span className="text-[11px] text-white/90">Payments</span>}
        right={
          <>
            <BarChip onClick={() => router.push("/admin/invoices?new=1")} label="New invoice" className="font-semibold"><FilePlus size={12} className="mr-1" /> New invoice</BarChip>
            <BarIcon href="/admin/invoices" label="Invoices" tone="white"><Receipt size={20} /></BarIcon>
          </>
        }
      />
    </div>
  );
}
