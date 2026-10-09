"use client";
import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { SegButton } from "@/components/ui/Controls";
import { useAction } from "@/components/finance/useAction";
import { markPaid } from "@/server/finance/payables";
import { vendorTdsStatus } from "@/server/finance/expenses";
import { GstBlock, billFiles, gstPayload, useGstState } from "@/components/finance/payables/GstBlock";
import { METHODS, inr, planText, sectionHead, type Item } from "@/components/finance/payables/payables-ui";

/**
 * Mark paid (prototype `markPaid`): amount (less than due leaves a balance), paid on, how you paid, reference, the
 * Bill & GST block, and TDS (% → amount, editable) with the payee FY threshold warning (salaries excluded).
 */
export function MarkPaidSheet({ item, today, onClose }: { item: Item; today: string; onClose: () => void }) {
  const { bill, occ } = item;
  const { pending, run, toast } = useAction();
  const [amount, setAmount] = useState(String(occ.amount));
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState(bill.kind === "SALARY" ? "BANK" : "UPI");
  const [reference, setReference] = useState("");
  const [tdsOn, setTdsOn] = useState(false);
  const [pct, setPct] = useState("10");
  const [tdsAmt, setTdsAmt] = useState("");
  const [tdsTyped, setTdsTyped] = useState(false);
  const [gst, setGst] = useGstState(occ, bill.vendorGstin);
  const [warn, setWarn] = useState<string | null>(null);
  const a = Number(amount) || 0;
  const tds = tdsOn ? (tdsTyped ? Number(tdsAmt) || 0 : Math.round((a * (Number(pct) || 0)) / 100)) : 0;

  useEffect(() => {
    if (bill.kind === "SALARY" || !bill.payee || tdsOn) return setWarn(null);
    const t = setTimeout(async () => {
      const res = await vendorTdsStatus(bill.payee, a, `${paidOn}T12:00:00`, occ.id);
      if (!res.ok || !res.data.crossed) return setWarn(null);
      const s = res.data;
      setWarn(`${s.alreadyCrossed ? `Already paid ${inr(s.paidSoFar)}` : `This takes ${bill.payee} to ${inr(s.withThis)}`} this FY (threshold ${inr(s.threshold)}). TDS has to be deducted on payments to this payee.`);
    }, 350);
    return () => clearTimeout(t);
  }, [bill.kind, bill.payee, a, paidOn, tdsOn, occ.id]);

  const submit = () => {
    if (a <= 0) return toast("Enter the amount", "err");
    run(
      () => markPaid(occ.id, { amount: a, paidOn, method, reference, tdsPercent: tdsOn && !tdsTyped ? Number(pct) || 0 : null, tdsAmount: tdsOn ? tds : 0, gst: gstPayload(gst, a) }, billFiles(gst)),
      (d) => {
        onClose();
        if (d.tdsWarning) toast(d.tdsWarning, "err");
        return d.message;
      },
    );
  };

  return (
    <Sheet open onClose={onClose} title={`Mark paid · ${bill.payee}`}>
      <div className="space-y-3 px-4 py-4">
        <Field label="Amount paid (₹)" hint={occ.label || planText(bill)}>
          <input className={inputCls} type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {a > 0 && occ.amount - a > 0.5 ? <p className="-mt-2 text-[11px] text-muted">Balance of {inr(occ.amount - a)} stays in To pay</p> : null}
        <Field label="Paid on">
          <input className={inputCls} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
        </Field>
        <Field label="How did you pay?">
          <div className="flex flex-wrap gap-1.5">
            {METHODS.map(([k, l]) => (
              <SegButton key={k} on={method === k} onClick={() => setMethod(k)}>{l}</SegButton>
            ))}
          </div>
        </Field>
        <Field label="Reference">
          <input className={inputCls} placeholder="UTR / cheque no. / note (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
        <div className={sectionHead.replace("px-3", "px-0")}>Bill &amp; GST</div>
        <GstBlock s={gst} set={setGst} amount={a} onError={(m) => toast(m, "err")} />
        {warn ? <div className="rounded-xl border border-hair bg-amber-100/80 px-3 py-2 text-xs text-amber-900">{warn}</div> : null}
        <label className="glass flex items-start gap-3 rounded-2xl px-3 py-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-blue" checked={tdsOn} onChange={(e) => setTdsOn(e.target.checked)} />
          <span>
            <b className="block">Deducted TDS on this payment</b>
            <span className="block text-[11px] text-muted">Pick the % · amount auto-fills</span>
          </span>
        </label>
        {tdsOn ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="TDS %">
                <input className={inputCls} type="number" min="0" max="100" step="0.01" value={pct} onChange={(e) => { setPct(e.target.value); setTdsTyped(false); }} />
              </Field>
              <Field label="TDS amount (₹)">
                <input className={inputCls} type="number" min="0" step="0.01" value={tdsTyped ? tdsAmt : String(tds)} onChange={(e) => { setTdsAmt(e.target.value); setTdsTyped(true); }} />
              </Field>
            </div>
            <p className="text-[11px] text-muted">You pay {inr(a - tds)} · TDS {inr(tds)} goes to the government in the payee&apos;s name</p>
          </>
        ) : null}
        <div className="flex gap-2 pt-1">
          <button type="button" className={`${btnSecondary} flex-1`} onClick={onClose}>Cancel</button>
          <button type="button" className={`${btnPrimary} flex-1`} disabled={pending} onClick={submit}>{pending ? "Saving…" : "Mark paid"}</button>
        </div>
      </div>
    </Sheet>
  );
}
