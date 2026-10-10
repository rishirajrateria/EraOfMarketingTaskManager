"use client";
import Link from "next/link";
import { BellRing, CalendarClock, CircleCheck, FileText, Receipt } from "lucide-react";
import { formatINRWhole as formatINR } from "@/server/finance/money";
import { sendReminder } from "@/server/finance/invoices";
import type { AwaitingRow, DashboardClientGroup } from "@/server/finance/queries";
import type { BillDueRow } from "@/server/finance/hub-queries";
import { DOC_LABEL, docNumber, fmtDay } from "@/components/finance/finance-ui";
import { useAction } from "@/components/finance/useAction";

/**
 * "Needs you" (ADR 0013): everything about money that waits for the owner, at the top of Payments & finance —
 * invoices to approve (opens the approve sheet), client invoices overdue (Remind) and vendor bills due (Pay).
 */
const actionCls = "inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3 text-[12px] font-semibold";
const primary = `${actionCls} bg-primary text-primary-ink`;
const soft = `${actionCls} border border-hair bg-chip text-ink`;

function Group({ icon: Icon, title, tone, count, children }: { icon: typeof FileText; title: string; tone: string; count: number; children: React.ReactNode }) {
  if (!count) return null;
  return (
    <div className="border-b border-line last:border-b-0">
      <h3 className="flex items-center gap-2 px-3 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-[.07em] text-muted">
        <span className={`flex h-5 w-5 items-center justify-center rounded-md text-white ${tone}`}><Icon size={12} /></span>
        {title}
        <span className="ml-auto rounded-full bg-chip px-1.5 text-[10.5px] text-ink">{count}</span>
      </h3>
      <ul>{children}</ul>
    </div>
  );
}

function Row({ title, sub, amount, late, action }: { title: React.ReactNode; sub: string; amount: number; late?: boolean; action: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold">{title}</div>
        <div className={`truncate text-[12px] ${late ? "text-red-600 dark:text-red-400" : "text-muted"}`}>{sub}</div>
      </div>
      <div className="shrink-0 text-right text-[13px] font-bold tabular-nums">{formatINR(amount)}</div>
      {action}
    </li>
  );
}

export function NeedsYou({ awaiting, overdue, bills, tz }: { awaiting: AwaitingRow[]; overdue: DashboardClientGroup[]; bills: BillDueRow[]; tz: string }) {
  const { pending, run } = useAction();
  const overdueInvoices = overdue.flatMap((g) => g.invoices.map((i) => ({ ...i, clientId: g.clientId, clientName: g.clientName })));
  const total = awaiting.length + overdueInvoices.length + bills.length;
  return (
    <section className="mx-4 mb-3">
      <h2 className="mb-1.5 flex items-center gap-2 px-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted">
        Needs you {total ? <span className="rounded-full bg-[#ef4444] px-1.5 text-[10.5px] text-white">{total}</span> : null}
      </h2>
      <div className="overflow-hidden rounded-[18px] border border-hair bg-glass shadow-[var(--shadow)]">
        {total === 0 ? (
          <p className="flex items-center gap-2 px-3 py-3 text-[13px] text-muted"><CircleCheck size={16} className="text-emerald-500" /> All caught up — nothing to approve, chase or pay.</p>
        ) : null}
        <Group icon={FileText} title="Approve & send" tone="bg-[linear-gradient(150deg,#f59e0b,#d97706)]" count={awaiting.length}>
          {awaiting.map((r) => (
            <Row
              key={r.id}
              title={r.clientName}
              sub={`${DOC_LABEL[r.docType as keyof typeof DOC_LABEL] ?? r.docType}${r.plan === "PART" ? ` · Part ${r.partSeq ?? ""}` : r.plan === "RECURRING" ? " · Recurring" : ""} · ${r.remindAt ? `reminder ${fmtDay(r.remindAt, tz)}` : `created ${fmtDay(r.createdAt, tz)}`}`}
              amount={r.total}
              action={<Link href={`/admin/invoices/${r.id}?approve=1`} className={primary}>Review</Link>}
            />
          ))}
        </Group>
        <Group icon={BellRing} title="Client payments overdue" tone="bg-[linear-gradient(150deg,#f87171,#dc2626)]" count={overdueInvoices.length}>
          {overdueInvoices.map((i) => (
            <Row
              key={i.id}
              title={<Link href={`/admin/invoices/${i.id}`}>{i.clientName}</Link>}
              sub={`${docNumber(i.number)} · due ${fmtDay(i.dueDate, tz)}`}
              amount={i.balance}
              late
              action={
                <button type="button" disabled={pending} className={soft} onClick={() => run(() => sendReminder(i.id), (d) => `Reminder ${d.reminderCount} sent${d.emailed ? " by email" : ""}${d.whatsapped ? " on WhatsApp" : ""}`)}>
                  Remind
                </button>
              }
            />
          ))}
        </Group>
        <Group icon={Receipt} title="Bills to pay" tone="bg-[linear-gradient(150deg,#a78bfa,#7c3aed)]" count={bills.length}>
          {bills.map((b) => (
            <Row
              key={b.occId}
              title={b.payee}
              sub={`${b.label ? `${b.label} · ` : ""}${b.category} · ${b.overdue ? "overdue since" : "due"} ${fmtDay(`${b.dueKey}T12:00:00Z`, tz)}`}
              amount={b.amount}
              late={b.overdue}
              action={<Link href={`/admin/expenses?tab=DUE&pay=${b.occId}`} className={soft}>Pay</Link>}
            />
          ))}
        </Group>
      </div>
      {bills.length ? (
        <p className="mt-1 flex items-center gap-1 px-1 text-[11px] text-muted"><CalendarClock size={12} /> Bills due in the next 7 days and anything overdue.</p>
      ) : null}
    </section>
  );
}
