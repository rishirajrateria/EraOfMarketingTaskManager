"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestLeave } from "@/server/leave/actions";
import { Field, btnPrimary, inputCls } from "@/components/ui/Field";
import { SheetButtons } from "@/components/ui/CloseX";
import { useToast } from "@/components/ui/Toast";

/** Request-leave form; rendered inside a Sheet opened from the bottom bar on /leave. */
export function LeaveForm({ defaultDate, onDone, onCancel }: { defaultDate: string; onDone?: () => void; onCancel?: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(defaultDate);
  const [to, setTo] = useState(defaultDate);
  const [reason, setReason] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await requestLeave({ from, to, reason });
      if (!r.ok) return toast(r.error, "err");
      toast("Leave requested — HR notified");
      setReason("");
      router.refresh();
      onDone?.();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="From">
          <input type="date" required className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" required min={from} className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Reason">
        <textarea className={inputCls} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
      </Field>
      {onCancel ? (
        <SheetButtons onClose={onCancel} disabled={pending}>
          <button type="submit" className={btnPrimary} disabled={pending}>
            Send to HR
          </button>
        </SheetButtons>
      ) : (
        <div className="flex justify-end gap-2">
          <button type="submit" className={btnPrimary} disabled={pending}>
            Send to HR
          </button>
        </div>
      )}
    </form>
  );
}
