"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnDanger, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/server/finance/money";
import type { InvoiceDetail } from "@/server/finance/queries";
import { deleteInvoice, generateBalanceInvoice, scheduleInvoice, sendInvoice, stopRecurrence } from "@/server/finance/invoices";
import { recordPayment } from "@/server/finance/payments";

/** Admin-only buttons on the invoice detail page: send / schedule / record payment / balance invoice / stop / delete. */
export function InvoiceActions({ inv }: { inv: InvoiceDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<"pay" | "schedule" | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = inv.status === "DRAFT" || inv.status === "SCHEDULED";
  const payable = !draft && inv.status !== "PAID";

  async function act<T>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, okMsg: (d: T) => string) {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return toast(res.error, "err");
    toast(okMsg(res.data));
    setSheet(null);
    router.refresh();
    return res.data;
  }

  async function onPay(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await act(
      () => recordPayment({ invoiceId: inv.id, amount: fd.get("amount"), receivedAt: fd.get("receivedAt"), method: fd.get("method"), reference: fd.get("reference") }),
      (d) => `Receipt ${d.receiptNumber} emailed · ${d.status === "PAID" ? "Paid in full" : `balance ${formatINR(d.balance)}`}`,
    );
  }
  async function onSchedule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get("sendAt") ?? "");
    if (!v) return toast("Pick a date/time", "err");
    await act(() => scheduleInvoice(inv.id, new Date(v).toISOString()), () => "Scheduled");
  }
  async function onDelete() {
    if (!confirm(`Delete ${inv.number}?`)) return;
    const res = await deleteInvoice(inv.id);
    if (!res.ok) return toast(res.error, "err");
    router.push("/admin/invoices");
  }

  return (
    <div className="flex flex-wrap gap-2 px-4 py-3">
      {draft ? (
        <button className={btnPrimary} disabled={busy} onClick={() => act(() => sendInvoice(inv.id), () => "Invoice sent")}>
          Send now
        </button>
      ) : null}
      {draft ? (
        <button className={btnSecondary} disabled={busy} onClick={() => setSheet("schedule")}>
          {inv.status === "SCHEDULED" ? "Reschedule" : "Schedule"}
        </button>
      ) : null}
      {payable ? (
        <button className={btnPrimary} disabled={busy} onClick={() => setSheet("pay")}>
          Mark as paid
        </button>
      ) : null}
      {inv.paymentMode === "ADVANCE" && !inv.balanceInvoice && !draft ? (
        <button className={btnSecondary} disabled={busy} onClick={() => act(() => generateBalanceInvoice(inv.id), (d) => `Balance invoice ${d.number} sent`)}>
          Generate balance invoice
        </button>
      ) : null}
      {inv.schedule && !inv.schedule.stopped ? (
        <button className={btnSecondary} disabled={busy} onClick={() => act(() => stopRecurrence(inv.id), () => "Recurrence stopped")}>
          Stop recurrence
        </button>
      ) : null}
      {draft ? (
        <button className={btnDanger} disabled={busy} onClick={onDelete}>
          Delete
        </button>
      ) : null}

      <Sheet open={sheet === "pay"} onClose={() => setSheet(null)} title="Record payment">
        <form onSubmit={onPay} className="space-y-3 px-4 py-4">
          <div className="text-sm text-gray-600">
            Balance outstanding: <b>{formatINR(inv.balance)}</b>
          </div>
          <Field label="Amount received (₹)">
            <input name="amount" type="number" step="0.01" min="0.01" required defaultValue={inv.balance} className={inputCls} inputMode="decimal" />
          </Field>
          <Field label="Date">
            <input name="receivedAt" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputCls} />
          </Field>
          <Field label="Method">
            <select name="method" className={inputCls} defaultValue="BANK_TRANSFER">
              <option value="BANK_TRANSFER">Bank transfer</option>
              <option value="UPI">UPI</option>
              <option value="CHEQUE">Cheque</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="OTHER">Other</option>
            </select>
          </Field>
          <Field label="Reference / UTR">
            <input name="reference" className={inputCls} />
          </Field>
          <button type="submit" disabled={busy} className={btnPrimary}>
            {busy ? "Saving…" : "Record & email receipt"}
          </button>
        </form>
      </Sheet>
      <Sheet open={sheet === "schedule"} onClose={() => setSheet(null)} title="Schedule send">
        <form onSubmit={onSchedule} className="space-y-3 px-4 py-4">
          <Field label="Send at">
            <input name="sendAt" type="datetime-local" required className={inputCls} />
          </Field>
          <button type="submit" disabled={busy} className={btnPrimary}>
            Schedule
          </button>
        </form>
      </Sheet>
    </div>
  );
}
