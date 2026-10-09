"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnDanger, btnPrimary, inputCls } from "@/components/ui/Field";
import { formatINR } from "@/server/finance/money";
import { createCreditNote, holdWork, pushForward } from "@/server/finance/invoices";
import type { InvoiceDetail } from "@/server/finance/queries";
import { addDaysKey } from "@/components/finance/finance-ui";
import { useAction } from "@/components/finance/useAction";

/** "Push forward": pick the day Admin wants to be reminded about this document. */
export function PushForwardSheet({ inv, open, onClose }: { inv: InvoiceDetail; open: boolean; onClose: () => void }) {
  const { pending, run } = useAction();
  const [date, setDate] = useState(addDaysKey(3));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(
      () => pushForward(inv.id, `${date}T09:00:00`),
      () => {
        onClose();
        return `Reminder set for ${date}`;
      },
    );
  };
  return (
    <Sheet open={open} onClose={onClose} title="Push forward">
      <form onSubmit={submit} className="space-y-3 px-4 py-4">
        <p className="text-sm text-gray-600">You will be notified on this date to approve or send {inv.number.startsWith("DRAFT-") ? "this draft" : inv.number}.</p>
        <div className="flex gap-2">
          {[1, 3, 7, 14].map((d) => (
            <button key={d} type="button" className="glass-chip rounded-full px-3 py-1 text-xs font-medium text-gray-800" onClick={() => setDate(addDaysKey(d))}>+{d}d</button>
          ))}
        </div>
        <Field label="Remind me on">
          <input type="date" required value={date} min={addDaysKey(1)} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        <button type="submit" className={`${btnPrimary} w-full`} disabled={pending}>{pending ? "Saving…" : "Set reminder"}</button>
      </form>
    </Sheet>
  );
}

/** "Hold work": confirm pausing every open task of the client until this invoice is paid. */
export function HoldWorkSheet({ inv, openTasks, open, onClose }: { inv: InvoiceDetail; openTasks: number; open: boolean; onClose: () => void }) {
  const { pending, run } = useAction();
  const confirm = () =>
    run(
      () => holdWork(inv.clientId, inv.id),
      (d) => {
        onClose();
        return `Work on hold for ${d.clientName} · ${d.paused} task${d.paused === 1 ? "" : "s"} paused`;
      },
    );
  return (
    <Sheet open={open} onClose={onClose} title="Hold work">
      <div className="space-y-3 px-4 py-4">
        <p className="text-sm text-gray-800">
          Pause all work for <b>{inv.clientName}</b> until {inv.number.startsWith("DRAFT-") ? "this invoice" : inv.number} ({formatINR(inv.balance)} outstanding) is paid?
        </p>
        <div className="glass rounded-2xl px-3 py-2 text-sm">
          <b>{openTasks}</b> open task{openTasks === 1 ? "" : "s"} will be paused and the assignees and team leaders notified. Work resumes automatically when the invoice is marked paid.
        </div>
        <button type="button" className={`${btnDanger} w-full`} disabled={pending} onClick={confirm}>{pending ? "Pausing…" : "Hold work"}</button>
      </div>
    </Sheet>
  );
}

/** Credit note against an approved invoice: amount (default remaining) + reason; approve it afterwards to apply. */
export function CreditNoteSheet({ inv, open, onClose }: { inv: InvoiceDetail; open: boolean; onClose: () => void }) {
  const { pending, run, router } = useAction();
  const [amount, setAmount] = useState(String(inv.balance > 0 ? inv.balance : inv.total));
  const [reason, setReason] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(
      () => createCreditNote(inv.id, { amount: Number(amount), reason }),
      (d) => {
        onClose();
        router.push(`/admin/invoices/${d.id}`);
        return "Credit note created — approve it to apply the credit";
      },
    );
  };
  const full = Math.abs(Number(amount) - inv.total) < 0.01;
  return (
    <Sheet open={open} onClose={onClose} title="Credit note">
      <form onSubmit={submit} className="space-y-3 px-4 py-4">
        <Field label="Amount (₹, incl. tax)" hint={full ? "Full amount: the invoice will be cancelled" : "Partial: reduces the outstanding balance"}>
          <input type="number" min="0.01" max={inv.total} step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} inputMode="decimal" />
        </Field>
        <Field label="Reason" hint="Printed on the credit note">
          <textarea rows={3} required value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} />
        </Field>
        <button type="submit" className={`${btnPrimary} w-full`} disabled={pending}>{pending ? "Creating…" : "Create credit note"}</button>
      </form>
    </Sheet>
  );
}
