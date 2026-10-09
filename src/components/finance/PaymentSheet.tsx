"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { formatINR, round2 } from "@/server/finance/money";
import { recordPayment, sendReceipt, type RecordPaymentView } from "@/server/finance/payments";
import type { InvoiceDetail } from "@/server/finance/queries";
import { METHOD_LABEL, PAYMENT_METHODS, dateKeyLocal, segActive, segIdle, type PaymentMethod } from "@/components/finance/finance-ui";
import { useAction } from "@/components/finance/useAction";

/** Record payment (amount / date / CASH BANK UPI OTHER / TDS % + amount / reference / notes), then offer "Send receipt". */
export function PaymentSheet({ inv, tdsPercent, open, onClose }: { inv: InvoiceDetail; tdsPercent: number | null; open: boolean; onClose: () => void }) {
  const { pending, run } = useAction();
  const initialTds = tdsPercent != null ? round2((inv.subtotal * tdsPercent) / 100) : 0;
  // Default: the client pays the balance net of the TDS they deduct; stops following TDS once the amount is edited.
  const [amount, setAmount] = useState(String(round2(Math.max(0, inv.balance - initialTds))));
  const [amountTouched, setAmountTouched] = useState(false);
  const [receivedAt, setReceivedAt] = useState(dateKeyLocal());
  const [method, setMethod] = useState<PaymentMethod>("BANK");
  const [tdsPct, setTdsPct] = useState(tdsPercent != null ? String(tdsPercent) : "");
  const [tdsAmount, setTdsAmount] = useState(initialTds ? String(initialTds) : "");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState<RecordPaymentView | null>(null);
  const [rEmail, setREmail] = useState(!!inv.client.email);
  const [rWhatsapp, setRWhatsapp] = useState(!!inv.client.whatsapp);

  const onTdsAmount = (v: string) => {
    setTdsAmount(v);
    if (!amountTouched) setAmount(String(round2(Math.max(0, inv.balance - (Number(v) || 0)))));
  };
  const onTdsPct = (v: string) => {
    setTdsPct(v);
    const n = Number(v);
    onTdsAmount(v === "" || !Number.isFinite(n) ? "" : String(round2((inv.subtotal * n) / 100)));
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(
      () => recordPayment({ invoiceId: inv.id, amount, receivedAt, method, tdsPercent: tdsPct === "" ? null : Number(tdsPct), tdsAmount: tdsAmount === "" ? null : Number(tdsAmount), reference: reference || null, notes: notes || null }),
      (d) => {
        setSaved(d);
        return d.status === "PAID" ? `Receipt ${d.receiptNumber} · paid in full` : `Receipt ${d.receiptNumber} · balance ${formatINR(d.balance)}`;
      },
    );
  };
  const send = () =>
    run(
      () => sendReceipt(saved!.paymentId, { email: rEmail, whatsapp: rWhatsapp }),
      (d) => {
        onClose();
        const via = [d.emailed && "email", d.whatsapped && "WhatsApp"].filter(Boolean).join(" + ");
        return `Receipt sent${via ? ` via ${via}` : ""}${d.errors.length ? ` · ${d.errors.join("; ")}` : ""}`;
      },
    );

  return (
    <Sheet open={open} onClose={onClose} title={saved ? "Send receipt" : "Record payment"}>
      {saved ? (
        <div className="space-y-3 px-4 py-4">
          <div className="glass-dark rounded-2xl px-4 py-3 text-sm text-white">
            <div className="font-semibold">Receipt {saved.receiptNumber}</div>
            <div className="text-xs opacity-85">{saved.status === "PAID" ? "Invoice paid in full" : `Balance ${formatINR(saved.balance)}`}{saved.tds > 0 ? ` · TDS ${formatINR(saved.tds)}` : ""}</div>
          </div>
          <label className={`glass flex items-center justify-between rounded-2xl px-3 py-2 text-sm ${inv.client.email ? "" : "opacity-60"}`}>
            <span>✉️ Email {inv.client.email ?? "(none on file)"}</span>
            <input type="checkbox" className="h-5 w-5 accent-brand-blue" checked={rEmail} disabled={!inv.client.email} onChange={(e) => setREmail(e.target.checked)} />
          </label>
          <label className={`glass flex items-center justify-between rounded-2xl px-3 py-2 text-sm ${inv.client.whatsapp ? "" : "opacity-60"}`}>
            <span>💬 WhatsApp {inv.client.whatsapp ?? "(none on file)"}</span>
            <input type="checkbox" className="h-5 w-5 accent-brand-blue" checked={rWhatsapp} disabled={!inv.client.whatsapp} onChange={(e) => setRWhatsapp(e.target.checked)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className={`${btnSecondary} flex-1`} onClick={onClose}>Not now</button>
            <button type="button" className={`${btnPrimary} flex-1`} disabled={pending || (!rEmail && !rWhatsapp)} onClick={send}>{pending ? "Sending…" : "Send receipt"}</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3 px-4 py-4">
          <div className="text-sm text-gray-600">Balance outstanding: <b>{formatINR(inv.balance)}</b></div>
          <Field label="Amount received (₹)">
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => {
                setAmountTouched(true);
                setAmount(e.target.value);
              }}
              className={`${inputCls} text-xl font-bold`}
              inputMode="decimal"
            />
          </Field>
          <Field label="Date">
            <input type="date" required value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Method">
            <div className="flex gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)} className={`touch-target flex-1 rounded-lg px-2 py-1.5 text-center text-sm ${method === m ? segActive : segIdle}`}>{METHOD_LABEL[m]}</button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="TDS %" hint="from the client card">
              <input type="number" min="0" max="100" step="0.01" value={tdsPct} onChange={(e) => onTdsPct(e.target.value)} className={inputCls} inputMode="decimal" />
            </Field>
            <Field label="TDS amount (₹)" hint={`= taxable ${formatINR(inv.subtotal)} × %`}>
              <input type="number" min="0" step="0.01" value={tdsAmount} onChange={(e) => onTdsAmount(e.target.value)} className={inputCls} inputMode="decimal" />
            </Field>
          </div>
          <Field label="Reference / UTR">
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Notes">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
          </Field>
          <button type="submit" disabled={pending} className={`${btnPrimary} w-full`}>{pending ? "Saving…" : "Record payment"}</button>
        </form>
      )}
    </Sheet>
  );
}
