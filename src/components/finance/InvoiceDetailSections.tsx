import Link from "next/link";
import { formatINR } from "@/server/finance/money";
import type { InvoiceDetail } from "@/server/finance/queries";
import { CopyButton } from "@/components/finance/CopyButton";
import { DOC_LABEL, DOC_TONE, STATUS_LABEL, STATUS_TONE, TAX_MODE_LABEL, chipCls, docNumber, fmtDay, fmtDayTime } from "@/components/finance/finance-ui";

/** Server-renderable blocks of the invoice detail page (ADR 0005). */
export function Row({ k, v, bold }: { k: string; v: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 text-sm ${bold ? "font-semibold" : ""}`}>
      <span className="text-gray-500">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

export function Section({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`glass mx-4 mb-3 rounded-2xl p-3 ${className}`}>
      <h2 className="mb-2 text-xs font-semibold uppercase text-gray-500">{title}</h2>
      {children}
    </section>
  );
}

export function DetailHeader({ inv, tz }: { inv: InvoiceDetail; tz: string }) {
  const planText = inv.plan === "RECURRING" ? "Recurring" : inv.plan === "PART" ? `Part ${inv.partSeq ?? ""}` : null;
  return (
    <div className="bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 px-4 pb-4 pt-3 text-white backdrop-blur-xl">
      <Link href="/admin/invoices" className="text-xs opacity-80">← Invoices</Link>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold">{docNumber(inv.number)}</h1>
        <span className={`${chipCls} ${STATUS_TONE[inv.status]}`}>{STATUS_LABEL[inv.status]}</span>
        <span className={`${chipCls} ${DOC_TONE[inv.docType]}`}>{DOC_LABEL[inv.docType]}</span>
        {planText ? <span className={`${chipCls} bg-white/25 text-white`}>{planText}</span> : null}
      </div>
      <div className="mt-0.5 text-sm opacity-90">{inv.clientName}</div>
      <div className="text-xs opacity-80">
        {TAX_MODE_LABEL[inv.taxMode]}
        {inv.placeOfSupply ? ` · Place of supply: ${inv.placeOfSupply}` : ""}
        {inv.dueDate ? ` · Due ${fmtDay(inv.dueDate, tz)}` : ""}
      </div>
      <div className="mt-2 flex items-end justify-between">
        <div>
          <div className="text-[11px] uppercase opacity-80">Total</div>
          <div className="text-xl font-bold">{formatINR(inv.total)}</div>
        </div>
        {inv.docType !== "CREDIT_NOTE" ? (
          <div className="text-right">
            <div className="text-[11px] uppercase opacity-80">Balance</div>
            <div className="text-xl font-bold">{formatINR(inv.balance)}</div>
          </div>
        ) : null}
      </div>
      {inv.remindAt ? <div className="mt-2 inline-flex rounded-full bg-white/25 px-2.5 py-0.5 text-[11px]">⏰ Reminder on {fmtDay(inv.remindAt, tz)}</div> : null}
    </div>
  );
}

export function AmountsBlock({ inv }: { inv: InvoiceDetail }) {
  return (
    <Section title="Amounts">
      {inv.items.length > 1 ? (
        <ul className="mb-2 divide-y divide-white/60">
          {inv.items.map((it) => (
            <li key={it.id} className="flex items-start justify-between gap-3 py-1.5 text-sm">
              <div>
                <div>{it.description}</div>
                <div className="text-xs text-gray-500">{it.hsnSac ? `HSN/SAC ${it.hsnSac} · ` : ""}{it.unit === "HOURS" ? `${it.qty} hrs × ${formatINR(it.rate)}` : "Fixed"}</div>
              </div>
              <div className="font-medium">{formatINR(it.amount)}</div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-1">
        <Row k="Taxable" v={formatINR(inv.subtotal)} />
        {inv.taxMode === "CGST_SGST" ? (
          <>
            <Row k={`CGST ${inv.gstPercent / 2}%`} v={formatINR(inv.cgstAmount)} />
            <Row k={`SGST ${inv.gstPercent / 2}%`} v={formatINR(inv.sgstAmount)} />
          </>
        ) : inv.taxMode === "IGST" ? (
          <Row k={`IGST ${inv.gstPercent}%`} v={formatINR(inv.igstAmount)} />
        ) : (
          <Row k={inv.taxMode === "EXPORT_LUT" ? "GST · 0% under LUT" : "Tax"} v={formatINR(0)} />
        )}
        <Row k="Total" v={formatINR(inv.total)} bold />
        {inv.docType !== "CREDIT_NOTE" ? (
          <>
            <div className="my-1 border-t border-white/60" />
            <Row k="Received" v={formatINR(inv.received)} />
            {inv.tds > 0 ? <Row k="TDS deducted" v={formatINR(inv.tds)} /> : null}
            {inv.credited > 0 ? <Row k="Credited" v={formatINR(inv.credited)} /> : null}
            <Row k="Balance" v={formatINR(inv.balance)} bold />
          </>
        ) : null}
      </div>
    </Section>
  );
}

export function ClientBlock({ inv, tz }: { inv: InvoiceDetail; tz: string }) {
  const c = inv.client;
  return (
    <Section title="Client">
      <div className="text-sm font-semibold">{inv.clientName}</div>
      <ul className="mt-1 space-y-0.5 text-xs">
        <li className={c.email ? "text-gray-700" : "text-amber-700"}>✉️ {c.email ?? "No email on file"}</li>
        <li className={c.whatsapp ? "text-gray-700" : "text-amber-700"}>💬 {c.whatsapp ?? "No WhatsApp number"}</li>
        {c.phone ? <li className="text-gray-700">📞 {c.phone}</li> : null}
        {c.gstNumber ? <li className="text-gray-700">GSTIN {c.gstNumber}</li> : null}
      </ul>
      {c.workOnHold ? (
        <div className="mt-2 rounded-lg border border-white/60 bg-red-100/70 px-2.5 py-1.5 text-xs text-red-800 backdrop-blur-sm">
          ⛔ Work on hold since {fmtDay(c.holdSince, tz)}{c.holdInvoiceId && c.holdInvoiceId !== inv.id ? <> · <Link className="underline" href={`/admin/invoices/${c.holdInvoiceId}`}>hold invoice</Link></> : null}
        </div>
      ) : null}
    </Section>
  );
}

export function SendStateBlock({ inv, tz }: { inv: InvoiceDetail; tz: string }) {
  return (
    <Section title="Approval & delivery">
      <div className="space-y-1">
        <Row k="Approved" v={inv.approvedAt ? fmtDayTime(inv.approvedAt, tz) : "Not yet"} />
        <Row k="Email" v={inv.emailSentAt ? `sent ${fmtDayTime(inv.emailSentAt, tz)}` : "—"} />
        <Row k="WhatsApp" v={inv.whatsappSentAt ? `sent ${fmtDayTime(inv.whatsappSentAt, tz)}` : inv.whatsappStatus ?? "—"} />
        {inv.reminderSentAt ? <Row k="Last reminder" v={`${fmtDayTime(inv.reminderSentAt, tz)} (${inv.reminderCount})`} /> : null}
        {inv.cancelledAt ? <Row k="Cancelled" v={fmtDayTime(inv.cancelledAt, tz)} /> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a href={`/api/files/invoice/${inv.id}`} target="_blank" rel="noreferrer" className="glass-chip rounded-full px-2.5 py-1 text-[11px] font-medium text-gray-800">
          {inv.approvedAt ? "📄 Download PDF" : "📄 Preview PDF"}
        </a>
        {inv.publicUrl ? <CopyButton text={inv.publicUrl} label="Copy public link" /> : null}
      </div>
    </Section>
  );
}

export function RelatedDocsBlock({ inv, tz }: { inv: InvoiceDetail; tz: string }) {
  const has = inv.creditNotes.length || inv.creditNoteOf || inv.convertedTo || inv.proformaOf;
  if (!has) return null;
  const DocLink = ({ id, number }: { id: string; number: string }) => (
    <Link href={`/admin/invoices/${id}`} className="text-brand-blue underline">{docNumber(number)}</Link>
  );
  return (
    <Section title="Related documents">
      <div className="space-y-1">
        {inv.proformaOf ? <Row k="Converted from proforma" v={<DocLink {...inv.proformaOf} />} /> : null}
        {inv.convertedTo ? <Row k="Converted to invoice" v={<><DocLink {...inv.convertedTo} /> <span className={`${chipCls} ml-1 ${STATUS_TONE[inv.convertedTo.status]}`}>{STATUS_LABEL[inv.convertedTo.status]}</span></>} /> : null}
        {inv.creditNoteOf ? <Row k="Credit note against" v={<DocLink {...inv.creditNoteOf} />} /> : null}
      </div>
      {inv.creditNotes.length ? (
        <ul className="mt-1 divide-y divide-white/60">
          {inv.creditNotes.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <div>
                <DocLink id={c.id} number={c.number} />
                <div className="text-xs text-gray-500">{c.description || "Credit note"}{c.approvedAt ? ` · approved ${fmtDay(c.approvedAt, tz)}` : " · awaiting approval"}</div>
              </div>
              <div className="text-right">
                <div className="font-medium">−{formatINR(c.total)}</div>
                <span className={`${chipCls} ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

export function PaymentsBlock({ inv, tz }: { inv: InvoiceDetail; tz: string }) {
  if (inv.docType === "CREDIT_NOTE" || inv.docType === "PROFORMA") return null;
  return (
    <Section title="Payments">
      {inv.payments.length === 0 ? <div className="text-sm text-gray-500">No payments recorded.</div> : null}
      <ul className="divide-y divide-white/60">
        {inv.payments.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <div>
              <div>{formatINR(p.amount)} · {p.method}{p.tdsAmount > 0 ? ` · TDS ${formatINR(p.tdsAmount)}` : ""}</div>
              <div className="text-xs text-gray-500">{fmtDay(p.receivedAt, tz)}{p.reference ? ` · ${p.reference}` : ""}{p.receiptSentAt ? " · receipt sent" : ""}{p.notes ? ` · ${p.notes}` : ""}</div>
            </div>
            {p.receiptNumber ? <a href={`/api/files/receipt/${p.id}`} target="_blank" rel="noreferrer" className="text-xs text-brand-blue underline">{p.receiptNumber}</a> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function NotesBlock({ inv, tz }: { inv: InvoiceDetail; tz: string }) {
  return (
    <Section title="Details">
      {inv.description ? <p className="mb-2 whitespace-pre-wrap text-sm text-gray-800">{inv.description}</p> : null}
      <div className="space-y-1">
        <Row k="Created" v={fmtDayTime(inv.createdAt, tz)} />
        {inv.paymentTerms ? <Row k="Terms" v={inv.paymentTerms} /> : null}
        {inv.notes ? <Row k="Notes" v={inv.notes} /> : null}
      </div>
    </Section>
  );
}
