"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { BarChip, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { useToast } from "@/components/ui/Toast";
import { exportExpensesCsv } from "@/server/finance/expenses";
import type { BillRow } from "@/server/finance/payables-queries";
import type { VendorTdsSummary } from "@/server/finance/tds";
import { downloadText } from "@/components/finance/finance-ui";
import { allItems, type Item } from "@/components/finance/payables/payables-ui";
import { BillsTab, DueTab, PaidTab, TdsTab } from "@/components/finance/payables/PayablesTabs";
import { GstCreditTab, gstMonthItems } from "@/components/finance/payables/GstCreditTab";
import { MarkPaidSheet } from "@/components/finance/payables/MarkPaidSheet";
import { BillDetailsSheet, OccurrenceSheet, SendPackSheet } from "@/components/finance/payables/OccurrenceSheets";

export const EXPENSE_TABS = [
  ["DUE", "To pay"],
  ["PAID", "Paid"],
  ["GST", "GST credit"],
  ["BILLS", "All bills"],
  ["TDS", "TDS by payee"],
] as const;
export type ExpenseTab = (typeof EXPENSE_TABS)[number][0];

type Props = { bills: BillRow[]; today: string; tab: ExpenseTab; gstMonth: string; tds: VendorTdsSummary; tdsFy: number; financeEmail: string; itcFolderUrl: string | null; canWrite: boolean };
type SheetState = { kind: "occ" | "pay" | "bill" | "pack"; item?: Item } | null;

/**
 * Expenses = payables (ADR 0009, prototype PAGES.expenses): bills with scheduled payments. Tabs in the bottom zone —
 * To pay · Paid · GST credit · All bills · TDS by payee — with per-tab actions in the bar.
 */
export function ExpensesView({ bills, today, tab: initialTab, gstMonth, tds, tdsFy, financeEmail, itcFolderUrl, canWrite }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<ExpenseTab>(initialTab);
  const [sheet, setSheet] = useState<SheetState>(null);
  const items = useMemo(() => allItems(bills), [bills]);
  const due = useMemo(() => items.filter((x) => x.occ.status === "DUE").sort((a, b) => a.occ.dueKey.localeCompare(b.occ.dueKey)), [items]);
  const paid = useMemo(() => items.filter((x) => x.occ.status === "PAID").sort((a, b) => (b.occ.paidKey ?? "").localeCompare(a.occ.paidKey ?? "")), [items]);
  const close = () => setSheet(null);
  const open = (x: Item) => setSheet({ kind: "occ", item: x });
  const pay = (x: Item) => (canWrite ? setSheet({ kind: "pay", item: x }) : undefined);
  const pickTab = (k: ExpenseTab) => {
    setTab(k);
    window.history.replaceState(null, "", k === "GST" ? `/admin/expenses?tab=GST&month=${gstMonth}` : `/admin/expenses?tab=${k}`);
  };
  const claim = gstMonthItems(paid, gstMonth).claim;

  async function onExport() {
    const res = await exportExpensesCsv({});
    if (!res.ok) return toast(res.error, "err");
    downloadText("expenses-paid.csv", res.data);
  }

  const body =
    tab === "DUE" ? <DueTab due={due} paid={paid} today={today} onOpen={open} onPay={pay} />
    : tab === "PAID" ? <PaidTab paid={paid} today={today} tdsFy={tdsFy} fyKey={tds.fyKey} onOpen={open} />
    : tab === "GST" ? <GstCreditTab paid={paid} month={gstMonth} onMonth={(m) => router.push(`/admin/expenses?tab=GST&month=${m}`)} onOpen={(x) => setSheet({ kind: "bill", item: x })} />
    : tab === "BILLS" ? <BillsTab bills={bills} today={today} />
    : <TdsTab tds={tds} />;

  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 px-4 pb-3 pt-3 text-white backdrop-blur-xl">
        <h1 className="text-base font-semibold">Expenses</h1>
        <div className="text-xs opacity-85">{due.length} to pay · {bills.length} bill{bills.length === 1 ? "" : "s"}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-white/55 pb-4 backdrop-blur-md">{body}</div>
      <BottomZone
        rows={
          <ZoneRow label="Expense tabs">
            {EXPENSE_TABS.map(([k, l]) => (
              <ZonePill key={k} active={tab === k} onClick={() => pickTab(k)}>{l}</ZonePill>
            ))}
          </ZoneRow>
        }
        left={
          tab === "GST" ? (
            <>
              {itcFolderUrl ? (
                <a href={itcFolderUrl} target="_blank" rel="noreferrer" className="no-select flex h-[22px] shrink-0 items-center rounded-full bg-green-pill px-2.5 text-[11px] text-[#111]">Drive</a>
              ) : null}
              <a href={`/api/finance/gst-pack?month=${gstMonth}`} className="no-select flex h-[22px] shrink-0 items-center rounded-full bg-green-pill px-2.5 text-[11px] text-[#111]">Download</a>
            </>
          ) : (
            <ZonePill onClick={onExport} label="Export paid payments as CSV">Export</ZonePill>
          )
        }
        right={
          canWrite ? (
            tab === "GST" ? (
              <BarChip onClick={() => setSheet({ kind: "pack" })} label="Send GST pack" className="font-semibold">Send</BarChip>
            ) : (
              <BarChip onClick={() => router.push("/admin/expenses/new")} label="Add expense" className="font-semibold">
                <Plus size={12} className="mr-0.5" /> Add expense
              </BarChip>
            )
          ) : null
        }
      />
      {sheet?.kind === "occ" && sheet.item ? (
        <OccurrenceSheet item={sheet.item} today={today} onClose={close} onMarkPaid={() => setSheet({ kind: "pay", item: sheet.item })} onBillDetails={() => setSheet({ kind: "bill", item: sheet.item })} />
      ) : null}
      {sheet?.kind === "pay" && sheet.item ? <MarkPaidSheet item={sheet.item} today={today} onClose={close} /> : null}
      {sheet?.kind === "bill" && sheet.item ? <BillDetailsSheet item={sheet.item} onClose={close} /> : null}
      {sheet?.kind === "pack" ? <SendPackSheet month={gstMonth} claim={claim} financeEmail={financeEmail} onClose={close} /> : null}
    </div>
  );
}
