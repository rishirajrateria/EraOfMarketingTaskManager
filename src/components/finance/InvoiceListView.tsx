"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Wallet } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { BarChip, BarIcon, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { formatINR, formatMoney } from "@/server/finance/money";
import type { InvoiceRow } from "@/server/finance/queries";
import { useFromAdd } from "@/components/dashboard/useFromAdd";
import { InvoiceWizard } from "@/components/finance/InvoiceWizard";
import type { ClientOpt } from "@/components/finance/wizard/types";
import { DOC_LABEL, DOC_TONE, STATUS_LABEL, STATUS_TONE, chipCls, docNumber, fmtDay } from "@/components/finance/finance-ui";
import { INVOICE_TABS, filterRows, listTiles, planChip, type InvoiceTab } from "@/components/finance/invoice-list-helpers";

type Props = { rows: InvoiceRow[]; tab: InvoiceTab; clients: ClientOpt[]; companyStateCode: string | null; defaultGst: number; defaultTerms: string; canWrite: boolean; tz: string; openNew?: boolean; holdClientIds: string[] };

/** Payment Creator list (ADR 0005): header tiles, bottom tabs, "+ New invoice" wizard. */
export function InvoiceListView({ rows, tab, clients, companyStateCode, defaultGst, defaultTerms, canWrite, tz, openNew = false, holdClientIds }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(openNew);
  // Opened from the "+" (`from=add`): the corner × (the wizard sheet's close) goes back to the dashboard.
  const back = useFromAdd();
  const cancelNew = () => {
    setOpen(false);
    back.done();
  };
  const tiles = useMemo(() => listTiles(rows), [rows]);
  const shown = filterRows(rows, tab);
  const onHold = new Set(holdClientIds);

  return (
    <div className="flex flex-1 flex-col">
      <div className="grid grid-cols-3 gap-2 bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 px-3 pb-3 pt-3 text-white backdrop-blur-xl">
        {[
          { label: "Outstanding", value: formatINR(tiles.outstanding) },
          { label: "Overdue", value: formatINR(tiles.overdue), warn: tiles.overdue > 0 },
          { label: "To approve", value: String(tiles.awaiting), warn: tiles.awaiting > 0 },
        ].map((t) => (
          <div key={t.label} className="rounded-xl border border-white/60 bg-white/85 px-2.5 py-2 backdrop-blur-md">
            <div className="truncate text-[10px] uppercase text-gray-600">{t.label}</div>
            <div className={`truncate text-sm font-bold ${t.warn ? "text-red-700" : "text-gray-900"}`}>{t.value}</div>
          </div>
        ))}
      </div>
      <ul className="min-h-0 flex-1 divide-y divide-white/60 overflow-y-auto bg-white/55 backdrop-blur-md">
        {shown.length === 0 ? <li className="px-4 py-10 text-center text-sm text-gray-500">{rows.length === 0 ? "No invoices yet. Tap + New invoice below." : "Nothing in this tab."}</li> : null}
        {shown.map((r) => {
          const plan = planChip(r);
          const overdue = r.status === "OVERDUE";
          return (
            <li key={r.id}>
              <Link href={`/admin/invoices/${r.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-white/70">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">{docNumber(r.number)}</span>
                    <span className={`${chipCls} ${DOC_TONE[r.docType]}`}>{DOC_LABEL[r.docType]}</span>
                    {plan ? <span className={`${chipCls} glass-chip text-gray-700`}>{plan}</span> : null}
                    {onHold.has(r.clientId) ? <span className={`${chipCls} border border-white/60 bg-red-100/70 text-red-700 backdrop-blur-sm`}>Hold</span> : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-gray-600">{r.clientName}</div>
                  <div className={`text-[11px] ${overdue ? "font-medium text-red-700" : "text-gray-500"}`}>
                    {r.dueDate ? `Due ${fmtDay(r.dueDate, tz)}` : `Created ${fmtDay(r.createdAt, tz)}`}
                    {r.remindAt ? ` · reminder ${fmtDay(r.remindAt, tz)}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-bold">{formatMoney(r.total, r.currency)}</div>
                  {r.balance !== r.total && r.docType !== "CREDIT_NOTE" ? <div className="text-[11px] text-gray-500">bal {formatMoney(r.balance, r.currency)}</div> : null}
                  <span className={`${chipCls} mt-1 ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      <BottomZone
        rows={
          <ZoneRow label="Invoice status">
            {INVOICE_TABS.map((t) => (
              <ZonePill key={t.key} active={tab === t.key} onClick={() => router.push(t.key === "all" ? "/admin/invoices" : `/admin/invoices?tab=${t.key}`)}>{t.label}</ZonePill>
            ))}
          </ZoneRow>
        }
        left={<span className="text-[11px] text-white/90">{shown.length} of {rows.length}</span>}
        right={
          <>
            {canWrite ? (
              <BarChip onClick={() => setOpen(true)} label="New invoice" className="font-semibold">
                <Plus size={12} className="mr-0.5" /> New invoice
              </BarChip>
            ) : null}
            <BarIcon href="/admin/payments" label="Payments" tone="white"><Wallet size={20} /></BarIcon>
          </>
        }
      />
      <Sheet open={open} onClose={cancelNew} full>
        {open ? <InvoiceWizard clients={clients} companyStateCode={companyStateCode} defaults={{ gstPercent: defaultGst, paymentTerms: defaultTerms }} onClose={() => setOpen(false)} /> : null}
      </Sheet>
    </div>
  );
}
