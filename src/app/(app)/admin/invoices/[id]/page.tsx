import Link from "next/link";
import { notFound } from "next/navigation";
import { requireFinancePage } from "@/server/finance/guard";
import { getInvoiceDetail } from "@/server/finance/queries";
import { getSettings } from "@/lib/settings";
import { formatINR } from "@/server/finance/money";
import { InvoiceActions } from "@/components/finance/InvoiceActions";
import { BALANCE_MODE_LABEL, STATUS_LABEL, STATUS_TONE, fmtDay, fmtDayTime } from "@/components/finance/finance-ui";

export const dynamic = "force-dynamic";

/** Invoice detail: items, totals, payments + receipts, status timeline, admin actions (SPEC §11.3). */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireFinancePage();
  const { id } = await params;
  const [inv, settings] = await Promise.all([getInvoiceDetail(id), getSettings()]);
  if (!inv) notFound();
  const tz = settings.timezone;
  const autoDraft = inv.status === "DRAFT" && inv.balanceOf?.balanceMode === "AUTO";
  const balanceText = inv.balanceMode === "DATE" && inv.balanceDueOn ? `on ${fmtDay(inv.balanceDueOn, tz)}` : BALANCE_MODE_LABEL[inv.balanceMode];
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-gray-500">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-brand-blue px-4 pb-4 pt-3 text-white">
        <Link href="/admin/invoices" className="text-xs opacity-80">← Invoices</Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-lg font-bold">{inv.number}</h1>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_TONE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
          {inv.kind === "RECURRING" ? <span title="Recurring">🔁</span> : null}
        </div>
        <div className="text-sm opacity-90">{inv.clientName}{inv.clientEmail ? ` · ${inv.clientEmail}` : " · no email on file"}</div>
        <div className="mt-2 flex items-end justify-between">
          <div>
            <div className="text-[11px] uppercase opacity-80">Total</div>
            <div className="text-xl font-bold">{formatINR(inv.total)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase opacity-80">Balance</div>
            <div className="text-xl font-bold">{formatINR(inv.balance)}</div>
          </div>
        </div>
      </div>

      {autoDraft ? (
        <div role="status" className="mx-4 mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <b>Auto-generated balance invoice</b> — review and Send. Raised because {inv.clientName}&apos;s tasks are complete (balance of{" "}
          {inv.balanceOf ? <Link className="underline" href={`/admin/invoices/${inv.balanceOf.id}`}>{inv.balanceOf.number}</Link> : null}). Nothing has been emailed yet.
        </div>
      ) : null}
      {user.canWrite ? <InvoiceActions inv={inv} tz={tz} /> : null}
      <div className="px-4 pb-2">
        <a href={`/api/files/invoice/${inv.id}`} target="_blank" rel="noreferrer" className="text-sm text-brand-blue underline">
          {inv.status === "DRAFT" || inv.status === "SCHEDULED" ? "Preview PDF" : "Download PDF"}
        </a>
      </div>

      <section className="mx-4 mb-3 rounded-lg bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase text-gray-500">Line items</h2>
        <ul className="divide-y">
          {inv.items.map((it) => (
            <li key={it.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div>
                <div>{it.description}</div>
                <div className="text-xs text-gray-500">
                  {it.hsnSac ? `HSN/SAC ${it.hsnSac} · ` : ""}
                  {it.unit === "HOURS" ? `${it.qty} hrs × ${formatINR(it.rate)}` : "Fixed"}
                </div>
              </div>
              <div className="font-medium">{formatINR(it.amount)}</div>
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-1 border-t pt-2">
          <Row k="Subtotal" v={formatINR(inv.subtotal)} />
          <Row k={`GST ${inv.gstPercent}%`} v={formatINR(inv.gstAmount)} />
          <Row k="Total" v={<b>{formatINR(inv.total)}</b>} />
        </div>
      </section>

      <section className="mx-4 mb-3 rounded-lg bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase text-gray-500">Details</h2>
        <div className="space-y-1">
          <Row k="Created" v={fmtDayTime(inv.createdAt, tz)} />
          {inv.sendAt && inv.status === "SCHEDULED" ? <Row k="Scheduled send" v={fmtDayTime(inv.sendAt, tz)} /> : null}
          {inv.sentAt ? <Row k="Sent" v={fmtDayTime(inv.sentAt, tz)} /> : null}
          <Row k="Due" v={fmtDay(inv.dueDate, tz)} />
          <Row k="Payment" v={inv.paymentMode === "ADVANCE" ? `Advance ${inv.advancePercent}% · balance ${balanceText}` : "Full"} />
          {inv.reminderSentAt ? <Row k="Last reminder" v={`${fmtDayTime(inv.reminderSentAt, tz)} (${inv.reminderCount})`} /> : null}
          {inv.balanceInvoice ? <Row k="Balance invoice" v={<Link className="text-brand-blue underline" href={`/admin/invoices/${inv.balanceInvoice.id}`}>{inv.balanceInvoice.number}</Link>} /> : null}
          {inv.balanceOf ? <Row k="Balance of" v={<Link className="text-brand-blue underline" href={`/admin/invoices/${inv.balanceOf.id}`}>{inv.balanceOf.number}</Link>} /> : null}
          {inv.schedule ? (
            <Row k="Recurs" v={`${inv.schedule.frequency.toLowerCase()} ×${inv.schedule.interval}${inv.schedule.stopped ? " (stopped)" : inv.schedule.nextRunAt ? ` · next ${fmtDay(inv.schedule.nextRunAt, tz)}` : ""}${inv.schedule.endDate ? ` · until ${fmtDay(inv.schedule.endDate, tz)}` : ""}`} />
          ) : null}
          {inv.paymentTerms ? <Row k="Terms" v={inv.paymentTerms} /> : null}
          {inv.notes ? <Row k="Notes" v={inv.notes} /> : null}
        </div>
      </section>

      <section className="mx-4 mb-6 rounded-lg bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase text-gray-500">Payments</h2>
        {inv.payments.length === 0 ? <div className="text-sm text-gray-500">No payments recorded.</div> : null}
        <ul className="divide-y">
          {inv.payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <div>{formatINR(p.amount)} · {p.method}</div>
                <div className="text-xs text-gray-500">
                  {fmtDay(p.receivedAt, tz)}
                  {p.reference ? ` · ${p.reference}` : ""}
                  {p.receiptSentAt ? " · receipt emailed" : ""}
                </div>
              </div>
              {p.receiptNumber ? (
                <a href={`/api/files/receipt/${p.id}`} target="_blank" rel="noreferrer" className="text-xs text-brand-blue underline">{p.receiptNumber}</a>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-2 border-t pt-2">
          <Row k="Received" v={formatINR(inv.received)} />
          <Row k="Outstanding" v={<b>{formatINR(inv.balance)}</b>} />
        </div>
      </section>
    </div>
  );
}
