"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionList, Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useAction } from "@/components/finance/useAction";
import { billDetails, moveDueDate, sendGstPack, skipOccurrence, undoPaid } from "@/server/finance/payables";
import { GstBlock, billFiles, gstPayload, useGstState } from "@/components/finance/payables/GstBlock";
import { TIMING, dLong, dueWords, inr, methodLabel, monthLong, planText, type Item } from "@/components/finance/payables/payables-ui";

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span className="text-muted">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

/** Tap on a payment (prototype `occSheet`): details + Mark paid / Move the due date / Skip / Undo paid / Bill & GST / Edit schedule. */
export function OccurrenceSheet({ item, today, onClose, onMarkPaid, onBillDetails }: { item: Item; today: string; onClose: () => void; onMarkPaid: () => void; onBillDetails: () => void }) {
  const { bill, occ } = item;
  const router = useRouter();
  const { run } = useAction();
  const [moving, setMoving] = useState(false);
  const [due, setDue] = useState(occ.dueKey);
  const items: { label: string; onClick: () => void; danger?: boolean; hint?: string }[] = [];
  if (occ.status === "DUE") {
    items.push({ label: "Mark paid", hint: "Record how and when you paid", onClick: onMarkPaid });
    items.push({ label: "Move the due date", onClick: () => setMoving(true) });
    if (bill.plan === "RECURRING") items.push({ label: "Skip this one", hint: "No payment this time; the next one stays", onClick: () => run(() => skipOccurrence(occ.id), () => { onClose(); return "Skipped"; }) });
  } else items.push({ label: "Undo paid", hint: "Back to To pay", onClick: () => run(() => undoPaid(occ.id), () => { onClose(); return "Marked unpaid"; }) });
  items.push({ label: occ.hasBill || occ.gstAmount ? "Bill & GST details" : "Attach bill · add GST", hint: "Vendor's invoice + GST you get back", onClick: onBillDetails });
  items.push({ label: "Edit schedule", onClick: () => router.push(`/admin/expenses/${bill.id}`) });

  if (moving) {
    return (
      <Sheet open onClose={onClose} title="New due date">
        <div className="space-y-3 px-4 py-4">
          <Field label="Due on">
            <input className={inputCls} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <button type="button" className={`${btnSecondary} flex-1`} onClick={() => setMoving(false)}>Cancel</button>
            <button type="button" className={`${btnPrimary} flex-1`} onClick={() => run(() => moveDueDate(occ.id, due), () => { onClose(); return "Due date moved"; })}>Save</button>
          </div>
        </div>
      </Sheet>
    );
  }
  const paid = occ.status === "PAID";
  const isImage = occ.billMime?.startsWith("image/");
  return (
    <Sheet open onClose={onClose} title={`${bill.payee} · ${inr(occ.amount)}`}>
      <div className="glass-card mx-4 mt-3 px-3 py-2">
        <Kv k="For" v={bill.note || bill.category} />
        <Kv k="Category" v={bill.category} />
        <Kv k="Type" v={`${bill.kind === "SALARY" ? "Salary" : "Regular"} · ${TIMING[bill.timing][0]}`} />
        <Kv k="Schedule" v={occ.label || planText(bill)} />
        <Kv k={paid ? "Paid on" : "Due"} v={paid ? `${dLong(occ.paidKey)} · ${methodLabel(occ.method)}` : `${dLong(occ.dueKey)} · ${dueWords(occ, today)}`} />
        {occ.reference ? <Kv k="Reference" v={occ.reference} /> : null}
        {occ.tdsAmount ? <Kv k="TDS" v={`${inr(occ.tdsAmount)}${occ.tdsPercent != null ? ` (${occ.tdsPercent}%)` : ""} · net ${inr(occ.amount - occ.tdsAmount)}`} /> : null}
        <Kv k="Reminder" v={bill.remindDays ? `${bill.remindDays} day${bill.remindDays > 1 ? "s" : ""} before` : "on the day"} />
        <Kv k="Bill" v={occ.hasBill ? <a className="text-brand-blue underline" href={`/api/files/bill/${occ.id}`} target="_blank" rel="noreferrer">📎 {occ.billName || "bill"}</a> : "not attached"} />
        <Kv k="GST" v={occ.gstAmount ? `${inr(occ.gstAmount)} @ ${occ.gstRate ?? "—"}% · ${occ.itcClaimable ? "you get it back" : "not claimable"}` : "none recorded"} />
      </div>
      {occ.hasBill && isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/api/files/bill/${occ.id}`} alt="Bill" className="mx-4 mt-2 max-h-44 rounded-xl border border-hair object-contain" />
      ) : null}
      <div className="mt-2">
        <ActionList items={items} />
      </div>
    </Sheet>
  );
}

/** "Bill & GST · <payee>" (prototype `billDetailsSheet`): attach / replace the bill and set the GST details. */
export function BillDetailsSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  const { bill, occ } = item;
  const { pending, run, toast } = useAction();
  const [gst, setGst] = useGstState(occ, bill.vendorGstin);
  const save = () => run(() => billDetails(occ.id, gstPayload(gst, occ.amount), billFiles(gst), gst.remove), () => { onClose(); return "Saved"; });
  return (
    <Sheet open onClose={onClose} title={`Bill & GST · ${bill.payee}`}>
      <div className="space-y-3 px-4 py-4">
        <GstBlock s={gst} set={setGst} amount={occ.amount} onError={(m) => toast(m, "err")} />
        <div className="flex gap-2 pt-1">
          <button type="button" className={`${btnSecondary} flex-1`} onClick={onClose}>Cancel</button>
          <button type="button" className={`${btnPrimary} flex-1`} disabled={pending} onClick={save}>{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Sheet>
  );
}

/** "Send <Month> GST pack" (prototype `sendPackSheet`): bills attached / missing, GST to claim, finance person's email. */
export function SendPackSheet({ month, claim, financeEmail, onClose }: { month: string; claim: Item[]; financeEmail: string; onClose: () => void }) {
  const { pending, run, toast } = useAction();
  const [email, setEmail] = useState(financeEmail);
  const files = claim.filter((x) => x.occ.hasBill).length;
  const send = () => {
    if (!/\S+@\S+\.\S+/.test(email)) return toast("Enter a valid email", "err");
    run(() => sendGstPack(month, email.trim()), (d) => { onClose(); return `GST pack sent to ${d.to} · ${d.bills} bill${d.bills === 1 ? "" : "s"}`; });
  };
  return (
    <Sheet open onClose={onClose} title={`Send ${monthLong(month)} GST pack`}>
      <div className="space-y-3 px-4 py-4">
        <div className="glass-card px-3 py-2">
          <Kv k="Bills" v={`${files} attached${claim.length > files ? ` · ${claim.length - files} missing` : ""}`} />
          <Kv k="GST to claim" v={<b>{inr(claim.reduce((s, x) => s + x.occ.gstAmount, 0))}</b>} />
          <Kv k="Includes" v="ZIP of bills + summary sheet" />
        </div>
        <Field label="Finance person's email" hint="Saved in Settings for next month">
          <input className={inputCls} type="email" placeholder="finance@yourca.in" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <button type="button" className={`${btnSecondary} flex-1`} onClick={onClose}>Cancel</button>
          <button type="button" className={`${btnPrimary} flex-1`} disabled={pending} onClick={send}>{pending ? "Sending…" : "Send"}</button>
        </div>
      </div>
    </Sheet>
  );
}
