import Link from "next/link";
import { formatINR } from "@/server/finance/money";
import type { AwaitingRow, DashboardClientGroup, PaymentsDashboard } from "@/server/finance/queries";
import { DOC_LABEL, METHOD_LABEL, STATUS_LABEL, STATUS_TONE, chipCls, docNumber, fmtDay } from "@/components/finance/finance-ui";

/** Sections of the Payments dashboard (server-renderable). */
export function Block({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="glass mx-4 mb-3 rounded-2xl p-3">
      <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase text-gray-500">
        <span>{title}</span>
        {count != null ? <span className="glass-chip rounded-full px-2 py-0.5 text-[10px] text-gray-700">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-gray-500">{children}</p>;

export function AwaitingList({ rows, tz }: { rows: AwaitingRow[]; tz: string }) {
  return (
    <Block title="Awaiting your approval" count={rows.length}>
      {rows.length === 0 ? <Empty>Nothing waiting. New invoices land here until you approve them.</Empty> : null}
      <ul className="divide-y divide-white/60">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/invoices/${r.id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.clientName}</div>
                <div className="text-xs text-gray-500">
                  {DOC_LABEL[r.docType as keyof typeof DOC_LABEL] ?? r.docType}{r.plan === "PART" ? ` · Part ${r.partSeq ?? ""}` : r.plan === "RECURRING" ? " · Recurring" : ""}
                  {r.remindAt ? ` · ⏰ ${fmtDay(r.remindAt, tz)}` : ` · created ${fmtDay(r.createdAt, tz)}`}
                </div>
              </div>
              <div className="shrink-0 text-right font-semibold">{formatINR(r.total)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </Block>
  );
}

export function ClientGroups({ title, groups, tz, tone }: { title: string; groups: DashboardClientGroup[]; tz: string; tone: "amber" | "red" }) {
  const total = groups.reduce((s, g) => s + g.balance, 0);
  return (
    <Block title={`${title} · ${formatINR(total)}`} count={groups.length}>
      {groups.length === 0 ? <Empty>Nothing here.</Empty> : null}
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.clientId} className="rounded-xl bg-white/50 p-2">
            <Link href={`/admin/payments/${g.clientId}`} className="flex items-center justify-between text-sm">
              <span className="font-semibold">{g.clientName}</span>
              <span className={`font-bold ${tone === "red" ? "text-red-700" : "text-amber-700"}`}>{formatINR(g.balance)}</span>
            </Link>
            <ul className="mt-1 space-y-0.5">
              {g.invoices.map((i) => (
                <li key={i.id}>
                  <Link href={`/admin/invoices/${i.id}`} className="flex items-center justify-between gap-2 text-xs text-gray-700">
                    <span>{docNumber(i.number)} · due {fmtDay(i.dueDate, tz)}</span>
                    <span className="flex items-center gap-1.5">
                      {formatINR(i.balance)}
                      <span className={`${chipCls} ${STATUS_TONE[i.status]}`}>{STATUS_LABEL[i.status]}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Block>
  );
}

export function UpcomingList({ upcoming, tz }: { upcoming: PaymentsDashboard["upcoming"]; tz: string }) {
  const items = [
    ...upcoming.parts.map((p) => ({ key: `p-${p.planId}-${p.seq}`, when: p.dueDate, title: p.clientName, sub: `Part ${p.seq} · ${p.title}`, amount: p.amount, href: `/admin/payments/${p.clientId}` })),
    ...upcoming.recurrences.map((r) => ({ key: `r-${r.ruleId}`, when: r.nextRunAt, title: r.clientName, sub: `Recurring · from ${docNumber(r.number)}`, amount: r.total, href: `/admin/invoices/${r.invoiceId}` })),
  ].sort((a, b) => a.when.localeCompare(b.when));
  return (
    <Block title="Upcoming" count={items.length}>
      {items.length === 0 ? <Empty>No scheduled parts or recurrences.</Empty> : null}
      <ul className="divide-y divide-white/60">
        {items.map((i) => (
          <li key={i.key}>
            <Link href={i.href} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{i.title}</div>
                <div className="truncate text-xs text-gray-500">{fmtDay(i.when, tz)} · {i.sub}</div>
              </div>
              <div className="shrink-0 font-semibold">{formatINR(i.amount)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </Block>
  );
}

/** Outstanding per client as horizontal bars (same look as FinanceCharts.ClientBars) with an on-hold badge. */
export function OutstandingBars({ rows }: { rows: PaymentsDashboard["outstandingByClient"] }) {
  const max = Math.max(1, ...rows.map((r) => r.balance));
  return (
    <Block title="Outstanding by client" count={rows.length}>
      {rows.length === 0 ? <Empty>Nothing outstanding.</Empty> : null}
      <ul className="space-y-2">
        {rows.map((c) => (
          <li key={c.clientId}>
            <Link href={`/admin/payments/${c.clientId}`} className="block">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 truncate font-medium">
                  {c.clientName}
                  {c.onHold ? <span className={`${chipCls} border border-white/60 bg-red-100/70 text-red-700 backdrop-blur-sm`}>On hold</span> : null}
                </span>
                <span className="text-gray-700">{formatINR(c.balance)}</span>
              </div>
              <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-white/60">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${(c.balance / max) * 100}%` }} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Block>
  );
}

const METHOD_COLOR: Record<string, string> = { CASH: "bg-amber-400", BANK: "bg-brand-blue", UPI: "bg-brand-green", OTHER: "bg-gray-400" };

export function ReceivedBlock({ d, tz, monthName }: { d: PaymentsDashboard; tz: string; monthName: string }) {
  const total = d.byMethod.reduce((s, m) => s + m.amount, 0);
  return (
    <Block title={`Received in ${monthName} · ${formatINR(d.tiles.receivedThisMonth)}`} count={d.payments.length}>
      {total > 0 ? (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/60">
            {d.byMethod.map((m) => (
              <div key={m.method} className={METHOD_COLOR[m.method] ?? "bg-gray-400"} style={{ width: `${(m.amount / total) * 100}%` }} title={`${METHOD_LABEL[m.method]} ${formatINR(m.amount)}`} />
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-gray-600">
            {d.byMethod.map((m) => (
              <span key={m.method} className="inline-flex items-center gap-1">
                <i className={`inline-block h-2 w-2 rounded-sm ${METHOD_COLOR[m.method] ?? "bg-gray-400"}`} />
                {METHOD_LABEL[m.method]} {formatINR(m.amount)} ({m.count})
              </span>
            ))}
          </div>
        </>
      ) : (
        <Empty>No payments received this month.</Empty>
      )}
      <ul className="mt-2 divide-y divide-white/60">
        {d.payments.map((p) => (
          <li key={p.id}>
            <Link href={`/admin/invoices/${p.invoiceId}`} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.clientName}</div>
                <div className="text-xs text-gray-500">
                  {fmtDay(p.receivedAt, tz)} · {METHOD_LABEL[p.method]} · {docNumber(p.invoiceNumber)}{p.receiptNumber ? ` · ${p.receiptNumber}` : ""}{p.receiptSentAt ? " ✓" : ""}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold">{formatINR(p.amount)}</div>
                {p.tdsAmount > 0 ? <div className="text-[11px] text-gray-500">TDS {formatINR(p.tdsAmount)}</div> : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Block>
  );
}
