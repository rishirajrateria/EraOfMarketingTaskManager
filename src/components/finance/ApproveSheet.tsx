"use client";
import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, inputCls } from "@/components/ui/Field";
import { formatINRNumber } from "@/server/finance/money";
import { approveAndSend } from "@/server/finance/invoices";
import type { ApproveResult } from "@/server/finance/approve-core";
import type { InvoiceDetail } from "@/server/finance/queries";
import { renderTemplate } from "@/components/finance/invoice-form-helpers";
import { fmtDay } from "@/components/finance/finance-ui";
import { useAction } from "@/components/finance/useAction";

export type Templates = { email: string; whatsapp: string; companyName: string };

/**
 * Approve & send confirm sheet (ADR 0005): PDF preview, editable email + WhatsApp text (placeholders rendered
 * client-side; `{{number}}` before approval and `{{link}}` are filled by the server at send time), channel
 * checkboxes, per-channel result. With both channels off the button reads "Approve only".
 */
export function ApproveSheet({ inv, tz, templates, open, onClose, resend }: { inv: InvoiceDetail; tz: string; templates: Templates; open: boolean; onClose: () => void; resend: boolean }) {
  const { pending, run } = useAction();
  const vars = useMemo(
    () => ({
      client: inv.clientName,
      number: inv.approvedAt ? inv.number : undefined,
      total: formatINRNumber(inv.total),
      balance: formatINRNumber(inv.balance),
      dueDate: inv.dueDate ? fmtDay(inv.dueDate, tz) : "receipt",
      company: templates.companyName,
    }),
    [inv, tz, templates.companyName],
  );
  const [emailText, setEmailText] = useState(() => renderTemplate(templates.email, vars));
  const [whatsappText, setWhatsappText] = useState(() => renderTemplate(templates.whatsapp, vars));
  const [email, setEmail] = useState(!!inv.client.email);
  const [whatsapp, setWhatsapp] = useState(!!inv.client.whatsapp);
  const [result, setResult] = useState<ApproveResult | null>(null);
  const label = !email && !whatsapp ? (resend ? "Nothing to send" : "Approve only") : resend ? "Resend" : "Confirm & send";

  const confirm = () =>
    run(
      () => approveAndSend(inv.id, { email, whatsapp, emailText: email ? emailText : null, whatsappText: whatsapp ? whatsappText : null }),
      (d) => {
        setResult(d);
        return d.status === "SENT" ? `${d.number} sent` : `${d.number} approved`;
      },
    );

  return (
    <Sheet open={open} onClose={onClose} title={resend ? "Resend" : "Approve & send"} full>
      <div className="space-y-4 px-4 py-4 pb-8">
        <div className="glass flex items-center justify-between rounded-2xl px-3 py-2 text-sm">
          <span>{inv.approvedAt ? inv.number : "Number assigned on approval"} · ₹{vars.total}</span>
          <a href={`/api/files/invoice/${inv.id}`} target="_blank" rel="noreferrer" className="glass-chip shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium text-gray-800">📄 Preview PDF</a>
        </div>
        {result ? (
          <div className="glass-dark space-y-1 rounded-2xl px-4 py-3 text-sm text-white">
            <div className="font-semibold">{result.number} · {result.status.toLowerCase().replace("_", " ")}</div>
            <div>✉️ Email: {email ? (result.emailed ? "sent" : "failed") : "skipped"}</div>
            <div>💬 WhatsApp: {whatsapp ? (result.whatsapped ? "sent" : "failed") : "skipped"}</div>
            {result.errors.map((e) => (
              <div key={e} className="text-xs text-amber-200">{e}</div>
            ))}
            <button type="button" className={`${btnPrimary} mt-2 w-full`} onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <label className={`glass flex items-center justify-between rounded-2xl px-3 py-2 text-sm ${inv.client.email ? "" : "opacity-60"}`}>
              <span>✉️ Email {inv.client.email ? <span className="text-xs text-gray-500">· {inv.client.email}</span> : <span className="text-xs text-amber-700">· no email on file</span>}</span>
              <input type="checkbox" className="h-5 w-5 accent-brand-blue" checked={email} disabled={!inv.client.email} onChange={(e) => setEmail(e.target.checked)} />
            </label>
            {email ? (
              <Field label="Email text" hint="{{number}} and {{link}} are filled in when sent">
                <textarea rows={6} value={emailText} onChange={(e) => setEmailText(e.target.value)} className={inputCls} />
              </Field>
            ) : null}
            <label className={`glass flex items-center justify-between rounded-2xl px-3 py-2 text-sm ${inv.client.whatsapp ? "" : "opacity-60"}`}>
              <span>💬 WhatsApp {inv.client.whatsapp ? <span className="text-xs text-gray-500">· {inv.client.whatsapp}</span> : <span className="text-xs text-amber-700">· no number on file</span>}</span>
              <input type="checkbox" className="h-5 w-5 accent-brand-blue" checked={whatsapp} disabled={!inv.client.whatsapp} onChange={(e) => setWhatsapp(e.target.checked)} />
            </label>
            {whatsapp ? (
              <Field label="WhatsApp text" hint="The PDF is attached as media via {{link}}">
                <textarea rows={4} value={whatsappText} onChange={(e) => setWhatsappText(e.target.value)} className={inputCls} />
              </Field>
            ) : null}
            <button type="button" className={`${btnPrimary} w-full py-3 text-base`} disabled={pending || (resend && !email && !whatsapp)} onClick={confirm}>
              {pending ? "Sending…" : label}
            </button>
            {!email && !whatsapp && !resend ? <p className="text-center text-xs text-gray-500">The number is allocated and the PDF stored; nothing is sent.</p> : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
