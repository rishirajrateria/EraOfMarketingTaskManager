"use client";
import Link from "next/link";
import { EmptyState } from "@/components/admin/AdminUi";
import type { BillRow, OccRow } from "@/server/finance/payables-queries";
import type { VendorTdsSummary } from "@/server/finance/tds";
import { TAG, TIMING, dLong, dayOff, dueWords, inr, isOver, methodLabel, planText, sectionHead, type Item } from "@/components/finance/payables/payables-ui";

/** Tab bodies of the Expenses screen (prototype PAGES.expenses): To pay · Paid · All bills · TDS by payee. GST credit lives in GstCreditTab. */
export function Tiles({ tiles }: { tiles: [string, string, boolean?][] }) {
  return (
    <div className="grid grid-cols-2 gap-2 px-3 pt-3">
      {tiles.map(([label, value, warn]) => (
        <div key={label} className="glass-tile !px-3.5 !py-2.5">
          <div className="truncate text-[10.5px] font-bold uppercase tracking-[.07em] text-muted">{label}</div>
          <div className={`text-base font-bold ${warn ? "text-acc-red" : "text-ink"}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}

export function BillTags({ bill, occ }: { bill: BillRow; occ: OccRow | null }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <span className={TAG.draft}>{bill.category}</span>
      {bill.kind === "SALARY" ? <span className={TAG.salary}>Salary</span> : null}
      <span className={TAG.draft}>{TIMING[bill.timing][0]}</span>
      <span className={TAG.sched}>{occ?.label || planText(bill)}</span>
    </div>
  );
}

const sum = (xs: Item[]) => xs.reduce((s, x) => s + x.occ.amount, 0);
const Empty = ({ children }: { children: React.ReactNode }) => <EmptyState>{children}</EmptyState>;

export function DueTab({ due, paid, today, onOpen, onPay }: { due: Item[]; paid: Item[]; today: string; onOpen: (x: Item) => void; onPay: (x: Item) => void }) {
  const over = due.filter((x) => isOver(x.occ, today));
  const week = due.filter((x) => !isOver(x.occ, today) && dayOff(x.occ.dueKey, today) <= 7);
  const later = due.filter((x) => dayOff(x.occ.dueKey, today) > 7);
  const month = today.slice(0, 7);
  const row = (x: Item) => {
    const late = isOver(x.occ, today);
    const n = dayOff(x.occ.dueKey, today);
    return (
      <li key={x.occ.id} className={`flex cursor-pointer items-start gap-3 px-3 py-2.5 ${late ? "bg-red-50/70" : ""}`} onClick={() => onOpen(x)}>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-sm">{x.bill.payee}</b>
          <small className="block truncate text-xs text-muted">{x.bill.note || x.bill.category}</small>
          <BillTags bill={x.bill} occ={x.occ} />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="text-sm font-bold">{inr(x.occ.amount)}</div>
          <span className={late ? TAG.over : n <= 3 ? TAG.await : TAG.draft}>{dueWords(x.occ, today)}</span>
          <button type="button" className="rounded-full bg-gray-900 px-2.5 py-1 text-[11px] font-semibold text-white" onClick={(e) => { e.stopPropagation(); onPay(x); }}>
            Mark paid
          </button>
        </div>
      </li>
    );
  };
  const group = (title: string, xs: Item[]) =>
    xs.length ? (
      <section key={title}>
        <div className={sectionHead}>{title} · {xs.length}</div>
        <ul className="divide-y divide-line">{xs.map(row)}</ul>
      </section>
    ) : null;
  return (
    <>
      <Tiles
        tiles={[
          ["Overdue", inr(sum(over)), over.length > 0],
          ["Due in 7 days", inr(sum(week))],
          ["Due this month", inr(sum(due.filter((x) => x.occ.dueKey.startsWith(month))))],
          ["Paid this month", inr(sum(paid.filter((x) => x.occ.paidKey?.startsWith(month))))],
        ]}
      />
      {group("Overdue", over)}
      {group("Next 7 days", week)}
      {group("Later", later)}
      {due.length ? null : <Empty>Nothing to pay. 🎉</Empty>}
    </>
  );
}

export function PaidTab({ paid, today, tdsFy, fyKey, onOpen }: { paid: Item[]; today: string; tdsFy: number; fyKey: string; onOpen: (x: Item) => void }) {
  const recent = paid.filter((x) => x.occ.paidKey && dayOff(x.occ.paidKey, today) >= -30);
  const byCat = new Map<string, number>();
  for (const x of recent) byCat.set(x.bill.category, (byCat.get(x.bill.category) ?? 0) + x.occ.amount);
  return (
    <>
      <Tiles tiles={[["Paid · 30 days", inr(sum(recent))], [`TDS deducted · FY ${fyKey}`, inr(tdsFy)]]} />
      {byCat.size ? (
        <div className="glass-card mx-3 mt-3 px-3 py-2">
          <h4 className="mb-1 text-xs font-semibold uppercase text-muted">By category · 30 days</h4>
          {Array.from(byCat.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm"><span>{k}</span><span>{inr(v)}</span></div>
            ))}
        </div>
      ) : null}
      <ul className="mt-2 divide-y divide-line">
        {paid.map((x) => (
          <li key={x.occ.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5" onClick={() => onOpen(x)}>
            <div className="min-w-0 flex-1">
              <b className="block truncate text-sm">{x.bill.payee}</b>
              <small className="block truncate text-xs text-muted">{dLong(x.occ.paidKey)} · {methodLabel(x.occ.method)}{x.occ.reference ? ` · ${x.occ.reference}` : ""}</small>
              <BillTags bill={x.bill} occ={x.occ} />
              <div className="mt-1 flex flex-wrap gap-1">
                {x.occ.tdsAmount ? <span className={TAG.paid}>TDS {inr(x.occ.tdsAmount)} · net {inr(x.occ.amount - x.occ.tdsAmount)}</span> : null}
                {x.occ.gstAmount ? <span className={x.occ.itcClaimable ? TAG.exp : TAG.draft}>GST {inr(x.occ.gstAmount)}{x.occ.itcClaimable ? " · claimable" : ""}</span> : null}
                {x.occ.hasBill ? <span className={TAG.draft}>📎 bill</span> : <span className={x.occ.itcClaimable ? TAG.over : `${TAG.draft} opacity-60`}>no bill</span>}
              </div>
            </div>
            <div className="shrink-0 text-sm font-bold">{inr(x.occ.amount)}</div>
          </li>
        ))}
      </ul>
      {paid.length ? null : <Empty>No payments recorded yet.</Empty>}
    </>
  );
}

export function BillsTab({ bills, today }: { bills: BillRow[]; today: string }) {
  if (!bills.length) return <Empty>No bills yet</Empty>;
  return (
    <ul className="divide-y divide-line">
      {bills
        .slice()
        .sort((a, b) => a.payee.localeCompare(b.payee))
        .map((b) => {
          const next = b.occurrences.find((o) => o.status === "DUE");
          const paidN = b.occurrences.filter((o) => o.status === "PAID").length;
          return (
            <li key={b.id}>
              <Link href={`/admin/expenses/${b.id}`} className="flex items-start gap-3 px-3 py-2.5 active:bg-white/70">
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{b.payee}</b>
                  <small className="block truncate text-xs text-muted">{[b.note, paidN ? `paid ${paidN}×` : null].filter(Boolean).join(" · ")}</small>
                  <BillTags bill={b} occ={null} />
                  <small className="mt-1 block text-xs text-muted">{next ? `Next: ${inr(next.amount)} ${dueWords(next, today)}${next.label ? ` · ${next.label}` : ""}` : "Nothing due"}</small>
                </div>
                <span className="glass-chip shrink-0 rounded-full px-2.5 py-0.5 text-xs">edit</span>
              </Link>
            </li>
          );
        })}
    </ul>
  );
}

export function TdsTab({ tds }: { tds: VendorTdsSummary }) {
  return (
    <>
      <p className="px-3 pb-1 pt-3 text-xs text-muted">
        Paid per payee this financial year (1 Apr – 31 Mar). Threshold {inr(tds.threshold)} · change it in Settings. Salaries are not counted here.
      </p>
      <ul className="divide-y divide-line">
        {tds.vendors.map((r) => {
          const needs = r.crossed && r.tds === 0;
          return (
            <li key={r.vendor} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <b className="block truncate text-sm">{r.vendor}</b>
                <small className="block text-xs text-muted">{r.expenses} payment{r.expenses > 1 ? "s" : ""} · TDS deducted {inr(r.tds)}</small>
                <div className="mt-1">
                  {needs ? <span className={TAG.over}>over threshold · deduct TDS</span> : r.crossed ? <span className={TAG.paid}>over threshold · TDS being deducted</span> : <span className={TAG.draft}>{inr(tds.threshold - r.paid)} left before threshold</span>}
                </div>
              </div>
              <div className={`shrink-0 text-sm font-bold ${needs ? "text-red-600" : ""}`}>{inr(r.paid)}</div>
            </li>
          );
        })}
      </ul>
      {tds.vendors.length ? null : <Empty>No payments to payees this financial year.</Empty>}
    </>
  );
}
