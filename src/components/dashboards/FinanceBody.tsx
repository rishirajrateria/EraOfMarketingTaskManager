"use client";
import Link from "next/link";
import type { FinanceDash } from "@/server/dashboards/finance";
import { BarList, Card, Empty, IncomeExpenseChart, Tile, Tiles } from "@/components/dashboards/charts";
import { useDash } from "@/components/dashboards/DashboardsScreen";
import { inr, inrShort } from "@/components/dashboards/format";

/** Finance view (prototype `finBody`): Overview · Income · Expense. `null` money = not per client (bills). */
const money = (n: number | null) => (n === null ? "—" : inr(n));
const NOT_PER_CLIENT = "not per client";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayLabel = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;

/** Lists behind the numbers (prototype `.dblinks`): the menu no longer has these rows (ADR 0016). */
const LINKS = {
  inv: ["Invoices", "/admin/invoices"],
  pay: ["Payments", "/admin/payments"],
  exp: ["Expenses", "/admin/expenses"],
  drv: ["Drive folders", "/admin/drive-folders"],
} as const;

function ListLinks({ keys }: { keys: (keyof typeof LINKS)[] }) {
  return (
    <nav aria-label="Finance lists" className="flex flex-wrap gap-1.5 px-0.5 pt-0.5">
      {keys.map((k) => (
        <Link key={k} href={LINKS[k][1]} className="glass-chip inline-flex h-8 items-center rounded-full border border-hair px-3 text-[12.5px] font-semibold text-ink">
          {LINKS[k][0]} ›
        </Link>
      ))}
    </nav>
  );
}

export function FinanceBody({ data: d }: { data: FinanceDash }) {
  const { params, go } = useDash();
  const pickClient = (id: string) => go({ client: params.client === id ? null : id });
  const active = params.fin === "EXP" ? null : params.client;

  if (params.fin === "INC") {
    return (
      <>
        <Tiles>
          <Tile label="Received" value={inr(d.received)} />
          <Tile label="Invoiced" value={inr(d.invoiced)} />
          <Tile label="TDS cut" value={inr(d.tds)} sub="credit at year end" />
          <Tile label="Outstanding" value={inr(d.outstanding)} />
          <Tile label="Overdue" value={inr(d.overdue)} sub={d.overdue > 0 ? "chase now" : null} alert={d.overdue > 0} />
          <Tile label="To approve" value={String(d.toApprove)} sub={d.toApprove === 1 ? "invoice" : "invoices"} />
        </Tiles>
        <Card title="Received by client">
          {d.receivedByClient.length ? <BarList rows={d.receivedByClient} fmt={inr} onPick={pickClient} activeId={active} /> : <Empty>Nothing received in this period</Empty>}
        </Card>
        <Card title="Still owed">
          {d.owed.length ? <BarList rows={d.owed} fmt={inr} onPick={pickClient} activeId={active} /> : <Empty>Nobody owes you anything</Empty>}
        </Card>
        <ListLinks keys={["inv", "pay"]} />
      </>
    );
  }

  if (params.fin === "EXP") {
    return (
      <>
        <Tiles>
          <Tile label="Spent" value={money(d.spent)} />
          <Tile label="To pay" value={money(d.toPay)} sub="next 30 days" />
          <Tile label="Overdue bills" value={money(d.billsOverdue)} alert={(d.billsOverdue ?? 0) > 0} sub={(d.billsOverdue ?? 0) > 0 ? "pay now" : null} />
          <Tile label="GST to claim" value={money(d.gstToClaim)} />
          <Tile label="TDS deducted" value={money(d.tdsDeducted)} sub="to deposit" />
          <Tile label="Bills paid" value={d.billsPaid === null ? "—" : String(d.billsPaid)} sub="this period" />
        </Tiles>
        <Card title="Spent by category">
          {d.byCategory.length ? <BarList rows={d.byCategory} fmt={inr} tone="exp" /> : <Empty>No expenses paid in this period</Empty>}
        </Card>
        <Card title="Next bills">
          {d.nextBills.length ? (
            <ul className="mt-1.5">
              {d.nextBills.map((b) => (
                <li key={b.occId} className="border-b border-line last:border-b-0">
                  <Link href={`/admin/expenses?tab=DUE&pay=${b.occId}`} className="flex items-center gap-2 py-2.5 text-[13px]" aria-label={`${b.payee}, ${inr(b.amount)}, ${b.overdue ? "overdue" : `due ${dayLabel(b.dueKey)}`}. Mark paid`}>
                    <span className="min-w-0 flex-1 truncate">
                      <b className="font-semibold">{b.payee}</b>
                      <span className={b.overdue ? "text-red-600 dark:text-red-400" : "text-muted"}> · {b.overdue ? "overdue" : `due ${dayLabel(b.dueKey)}`}</span>
                    </span>
                    <b className="shrink-0 tabular-nums">{inr(b.amount)}</b>
                    <span className="shrink-0 rounded-full border border-hair bg-chip px-2 py-0.5 text-[11px] font-semibold">Pay</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>Nothing due</Empty>
          )}
        </Card>
        <ListLinks keys={["exp", "drv"]} />
      </>
    );
  }

  return (
    <>
      <Tiles>
        <Tile label="Received" value={inr(d.received)} />
        <Tile label="Spent" value={money(d.spent)} sub={d.spent === null ? NOT_PER_CLIENT : null} />
        <Tile label="Net" value={money(d.net)} sub={d.net === null ? NOT_PER_CLIENT : null} alert={(d.net ?? 0) < 0} />
        <Tile label="Outstanding" value={inr(d.outstanding)} sub={d.overdue > 0 ? `${inrShort(d.overdue)} overdue` : null} alert={d.overdue > 0} />
        <Tile label="To pay" value={money(d.toPay)} sub={d.toPay === null ? NOT_PER_CLIENT : "next 30 days"} />
        <Tile label="GST to claim" value={money(d.gstToClaim)} sub={d.gstToClaim === null ? NOT_PER_CLIENT : null} />
      </Tiles>
      {d.months.length ? <IncomeExpenseChart months={d.months} /> : null}
      <Card title="Top clients · received">
        {d.receivedByClient.length ? <BarList rows={d.receivedByClient.slice(0, 5)} fmt={inr} onPick={pickClient} activeId={active} /> : <Empty>Nothing received in this period</Empty>}
      </Card>
      <ListLinks keys={["inv", "pay", "exp", "drv"]} />
    </>
  );
}
