import Link from "next/link";
import { formatINR } from "@/server/finance/money";
import type { FinanceSummary as Summary } from "@/server/finance/queries";
import type { TdsSummary } from "@/server/finance/tds";
import type { PayablesTiles } from "@/server/finance/payables-queries";
import { ClientBars, MonthlyBars } from "@/components/finance/FinanceCharts";

/**
 * The finance summary on the Payments & finance hub (ADR 0013; was the separate "Finance sheet", SPEC §11.4):
 * invoiced / received / outstanding / expenses / net, payables tiles, last 12 months, per client, TDS, per month.
 * Proformas never count (ADR 0013). Server-rendered.
 */
const card = "rounded-[18px] border border-hair bg-glass p-3 shadow-[var(--shadow)]";
const h2 = "mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted";

function Tile({ label, value, cls = "", href }: { label: string; value: string; cls?: string; href?: string }) {
  const body = (
    <>
      <div className="truncate text-[10.5px] font-semibold uppercase tracking-[.04em] text-muted">{label}</div>
      <div className={`truncate text-[15px] font-bold tabular-nums ${cls}`}>{value}</div>
    </>
  );
  const c = "min-w-0 rounded-xl border border-hair bg-glass-strong px-2.5 py-1.5";
  return href ? <Link href={href} className={c}>{body}</Link> : <div className={c}>{body}</div>;
}

export function FinanceSummary({ summary, tds, pay, previousFy }: { summary: Summary; tds: TdsSummary; pay: PayablesTiles; previousFy: boolean }) {
  const t = summary.totals;
  const red = "text-red-600 dark:text-red-400";
  return (
    <>
      <section className="mx-4 mb-3">
        <h2 className={h2}>Finance summary · last 12 months</h2>
        <div className="grid grid-cols-3 gap-1.5">
          <Tile label="Invoiced" value={formatINR(t.invoiced)} cls="text-brand-blue dark:text-sky-300" />
          <Tile label="Received" value={formatINR(t.received)} cls="text-emerald-600 dark:text-emerald-400" />
          <Tile label="Outstanding" value={formatINR(t.outstanding)} cls="text-amber-600 dark:text-amber-400" />
          <Tile label="Expenses paid" value={formatINR(t.expenses)} cls={red} />
          <Tile label="Net" value={formatINR(t.net)} cls={t.net < 0 ? red : ""} />
          <Tile label="To pay · 30d" value={formatINR(pay.toPay30)} />
          <Tile label="Overdue to pay" value={formatINR(pay.overdue)} cls={pay.overdue > 0 ? red : ""} />
          <Tile label={`GST to claim · ${pay.monthShort}`} value={formatINR(pay.gstToClaim)} cls="text-teal-600 dark:text-teal-300" href={`/admin/expenses?tab=GST&month=${pay.month}`} />
          <Tile label="Bills attached" value={`${pay.billsAttached} this month`} href={`/admin/expenses?tab=GST&month=${pay.month}`} />
        </div>
      </section>

      <section className="mx-4 mb-3">
        <h2 className={h2}>Last 12 months</h2>
        <div className={card}>
          <MonthlyBars months={summary.months} />
        </div>
      </section>

      <section className="mx-4 mb-3">
        <h2 className={h2}>Per client</h2>
        <div className={card}>{summary.clients.length === 0 ? <p className="text-[13px] text-muted">No sent invoices yet.</p> : <ClientBars clients={summary.clients} />}</div>
      </section>

      <section className="mx-4 mb-3">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <h2 className="text-[11px] font-bold uppercase tracking-[.08em] text-muted">TDS · FY {tds.fyKey}</h2>
          <div className="flex gap-1 text-[11px]">
            <Link href="/admin/payments#tds" className={`rounded-full border border-hair px-2 py-0.5 ${!previousFy ? "bg-primary text-primary-ink" : "bg-chip"}`}>This FY</Link>
            <Link href="/admin/payments?fy=previous#tds" className={`rounded-full border border-hair px-2 py-0.5 ${previousFy ? "bg-primary text-primary-ink" : "bg-chip"}`}>Previous FY</Link>
          </div>
        </div>
        <div id="tds" className="grid grid-cols-2 gap-1.5">
          <div className={card}>
            <div className="text-[10.5px] font-semibold uppercase text-muted">TDS receivable</div>
            <div className="text-[15px] font-bold text-brand-blue dark:text-sky-300">{formatINR(tds.receivable)}</div>
            <div className="text-[10.5px] text-muted">deducted by clients · credit at year end</div>
          </div>
          <div className={card}>
            <div className="text-[10.5px] font-semibold uppercase text-muted">TDS on expenses</div>
            <div className="text-[15px] font-bold text-amber-600 dark:text-amber-400">{formatINR(tds.onExpenses)}</div>
            <div className="text-[10.5px] text-muted">withheld from payees · to deposit</div>
          </div>
        </div>
        {tds.byClient.length === 0 ? (
          <p className="mt-1.5 px-1 text-[12px] text-muted">No TDS recorded on payments in this financial year.</p>
        ) : (
          <ul className="mt-1.5 overflow-hidden rounded-[18px] border border-hair bg-glass">
            {tds.byClient.map((c) => (
              <li key={c.clientId} className="flex items-center justify-between gap-2 border-b border-line px-3 py-2 text-[13px] last:border-b-0">
                <span className="min-w-0 truncate">
                  {c.clientName}
                  <span className="ml-1 text-[11px] text-muted">· {c.payments} payment{c.payments === 1 ? "" : "s"}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatINR(c.tds)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mx-4 mb-3">
        <h2 className={h2}>Per month</h2>
        <div className={`${card} overflow-x-auto p-2`}>
          <table className="w-full text-[11.5px] tabular-nums">
            <thead className="text-left text-muted">
              <tr><th className="py-1 font-semibold">Month</th><th className="text-right font-semibold">Invoiced</th><th className="text-right font-semibold">Received</th><th className="text-right font-semibold">Expenses</th><th className="text-right font-semibold">Net</th></tr>
            </thead>
            <tbody>
              {summary.months.map((m) => (
                <tr key={m.month} className="border-t border-line">
                  <td className="py-1">{m.month}</td>
                  <td className="text-right">{formatINR(m.invoiced)}</td>
                  <td className="text-right">{formatINR(m.received)}</td>
                  <td className="text-right">{formatINR(m.expenses)}</td>
                  <td className={`text-right ${m.net < 0 ? red : ""}`}>{formatINR(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
