"use client";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, FilePlus, Receipt } from "lucide-react";
import { BarChip, BarIcon, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { formatINRWhole as formatINR } from "@/server/finance/money";
import type { PaymentsDashboard } from "@/server/finance/queries";
import { ClientGroups, OutstandingBars, ReceivedBlock, UpcomingList } from "@/components/finance/PaymentsSections";
import { METHOD_LABEL, PAYMENT_METHODS, monthLabel, shiftMonthKey, type PaymentMethod } from "@/components/finance/finance-ui";

type Props = {
  data: PaymentsDashboard;
  method: PaymentMethod | null;
  tz: string;
  /** "Needs you" block (approvals, overdue client invoices, bills due). */
  needs: React.ReactNode;
  /** Finance summary (totals, charts, TDS, per month) — server-rendered. */
  summary: React.ReactNode;
};

/**
 * /admin/payments — the Payments & finance hub (ADR 0013): tiles, Needs you, the finance summary (was the Finance
 * sheet), then the payments lists (overdue / due soon by client, upcoming, outstanding bars, received this month).
 */
export function PaymentsDashboardView({ data, method, tz, needs, summary }: Props) {
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
    { label: "Outstanding", value: formatINR(t.outstanding), cls: "text-amber-600 dark:text-amber-400" },
    { label: "Overdue", value: formatINR(t.overdue), cls: t.overdue > 0 ? "text-red-600 dark:text-red-400" : "" },
    { label: `Received · ${monthLabel(data.month)}`, value: formatINR(t.receivedThisMonth), cls: "text-emerald-600 dark:text-emerald-400" },
    { label: "Awaiting approval", value: `${t.awaitingApprovalCount} · ${formatINR(t.awaitingApproval)}`, cls: t.awaitingApprovalCount > 0 ? "text-amber-600 dark:text-amber-400" : "" },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pb-2 pt-3">
        <div className="grid grid-cols-2 gap-1.5">
          {tiles.map((x) => (
            <div key={x.label} className="min-w-0 rounded-xl border border-hair bg-glass-strong px-2.5 py-1.5 shadow-[var(--shadow)]">
              <div className="truncate text-[10.5px] font-semibold uppercase tracking-[.04em] text-muted">{x.label}</div>
              <div className={`truncate text-[15px] font-bold tabular-nums ${x.cls}`}>{x.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3 pt-1">
        {needs}
        {summary}
        <h2 className="mx-5 mb-1.5 mt-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted">Payments</h2>
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
        left={<span className="text-[11px] text-white/90">Payments &amp; finance</span>}
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
