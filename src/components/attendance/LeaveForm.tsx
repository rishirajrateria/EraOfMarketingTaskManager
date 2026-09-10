"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestLeave } from "@/server/leave/actions";
import { Field, btnPrimary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

export function LeaveForm({ defaultDate }: { defaultDate: string }) {
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
    });
  };

  return (
    <form onSubmit={submit} className="mx-3 mt-3 space-y-3 rounded-xl bg-white p-4 shadow-sm">
      <h2 className="text-sm font-semibold">Request leave</h2>
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
      <div className="flex justify-end">
        <button type="submit" className={btnPrimary} disabled={pending}>
          Send to HR
        </button>
      </div>
    </form>
  );
}
