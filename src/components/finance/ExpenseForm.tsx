"use client";
import { useEffect, useState } from "react";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { createExpense, updateExpense, vendorTdsStatus } from "@/server/finance/expenses";
import type { ExpenseRow } from "@/server/finance/queries";
import type { TdsThresholdStatus } from "@/server/finance/tds";
import { formatINR, round2 } from "@/server/finance/money";
import { VoiceRecorder } from "@/components/finance/VoiceRecorder";

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Add / edit expense sheet body (SPEC §11.2): bill photo via camera, voice note via MediaRecorder.
 * `categories` is the fixed list from Settings (ADR 0004) — no free text.
 * ADR 0006: "Deduct TDS" with % / amount (amount auto-computed, editable) and a live payee-threshold banner.
 */
export function ExpenseForm({ initial, categories, onDone }: { initial?: ExpenseRow | null; categories: string[]; onDone: () => void }) {
  const toast = useToast();
  const legacyCategory = initial && !categories.some((c) => c.toLowerCase() === initial.category.toLowerCase()) ? initial.category : null;
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<{ blob: Blob; dur: number } | null>(null);
  const [preview, setPreview] = useState<string | null>(initial?.hasReceipt ? `/api/files/expense/${initial.id}/receipt` : null);
  const [date, setDate] = useState(initial ? initial.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [vendor, setVendor] = useState(initial?.vendor ?? "");
  const [tdsApplied, setTdsApplied] = useState(initial?.tdsApplied ?? false);
  const [tdsPercent, setTdsPercent] = useState(initial?.tdsPercent != null ? String(initial.tdsPercent) : "");
  const [tdsAmount, setTdsAmount] = useState(initial && initial.tdsAmount > 0 ? String(initial.tdsAmount) : "");
  const [status, setStatus] = useState<TdsThresholdStatus | null>(null);

  // Live threshold check (debounced) — the server resolves the FY and the payee's total case-insensitively.
  useEffect(() => {
    const v = vendor.trim();
    if (!v) return setStatus(null);
    const t = setTimeout(async () => {
      const res = await vendorTdsStatus(v, num(amount), date, initial?.id ?? null);
      setStatus(res.ok ? res.data : null);
    }, 400);
    return () => clearTimeout(t);
  }, [vendor, amount, date, initial?.id]);

  const onPercent = (v: string) => {
    setTdsPercent(v);
    setTdsAmount(v === "" ? "" : String(round2((num(amount) * num(v)) / 100)));
  };
  const onAmount = (v: string) => {
    setAmount(v);
    if (tdsApplied && tdsPercent !== "") setTdsAmount(String(round2((num(v) * num(tdsPercent)) / 100)));
  };
  const net = round2(Math.max(0, num(amount) - (tdsApplied ? num(tdsAmount) : 0)));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (voice) {
      fd.set("voice", new File([voice.blob], "voice.webm", { type: voice.blob.type || "audio/webm" }));
      fd.set("voiceDurationSec", String(voice.dur));
    }
    setBusy(true);
    const res = initial ? await updateExpense(initial.id, fd) : await createExpense(fd);
    setBusy(false);
    if (!res.ok) return toast(res.error, "err");
    toast(initial ? "Expense updated" : "Expense added");
    if (res.data.tdsWarning) toast(res.data.tdsWarning, "err");
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input name="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Amount (₹)" hint="gross bill amount">
          <input name="amount" type="number" step="0.01" min="0" required value={amount} onChange={(e) => onAmount(e.target.value)} className={inputCls} inputMode="decimal" />
        </Field>
      </div>
      <Field label="Category" hint={legacyCategory ? `"${legacyCategory}" is no longer in the list — pick a current category to save` : "Managed in Settings → Expenses"}>
        <select name="category" required defaultValue={initial?.category ?? categories[0] ?? ""} className={inputCls}>
          {legacyCategory ? (
            <option value={legacyCategory} disabled>
              {legacyCategory} (removed)
            </option>
          ) : null}
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Vendor">
        <input name="vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputCls} />
      </Field>
      {status && status.crossed && !tdsApplied ? (
        <div role="status" className="rounded-xl border border-white/60 bg-amber-100/70 px-3 py-2 text-xs text-amber-900 backdrop-blur-sm">
          Paid {formatINR(status.withThis)} to <b>{status.vendor}</b> this FY (threshold {formatINR(status.threshold)}). TDS applies.
        </div>
      ) : status && status.vendor ? (
        <p className="text-[11px] text-gray-500">
          {formatINR(status.paidSoFar)} paid to {status.vendor} in FY {status.fyKey} so far · threshold {formatINR(status.threshold)}
        </p>
      ) : null}
      <label className="glass flex items-center justify-between rounded-2xl px-3 py-2 text-sm">
        <span>
          <span className="block">Deduct TDS</span>
          <span className="block text-[11px] text-gray-400">You pay the vendor net of TDS and deposit it with the government</span>
        </span>
        <input name="tdsApplied" type="checkbox" className="h-5 w-5 accent-brand-blue" checked={tdsApplied} onChange={(e) => setTdsApplied(e.target.checked)} />
      </label>
      {tdsApplied ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="TDS %">
              <input name="tdsPercent" type="number" min="0" max="100" step="0.01" value={tdsPercent} onChange={(e) => onPercent(e.target.value)} className={inputCls} inputMode="decimal" />
            </Field>
            <Field label="TDS amount (₹)" hint="= amount × %; editable">
              <input name="tdsAmount" type="number" min="0" step="0.01" value={tdsAmount} onChange={(e) => setTdsAmount(e.target.value)} className={inputCls} inputMode="decimal" />
            </Field>
          </div>
          <p className="text-sm text-gray-700">
            Net payable <b>{formatINR(net)}</b>
          </p>
        </>
      ) : null}
      <Field label="Note">
        <textarea name="note" defaultValue={initial?.note ?? ""} className={inputCls} rows={2} />
      </Field>
      <Field label="Tags" hint="comma separated">
        <input name="tags" defaultValue={initial?.tags.join(", ") ?? ""} className={inputCls} />
      </Field>
      <Field label="Photo of the bill">
        <input
          name="receipt"
          type="file"
          accept="image/*"
          capture="environment"
          className="block w-full text-sm"
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            setPreview(f ? URL.createObjectURL(f) : preview);
          }}
        />
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Receipt" className="mt-2 max-h-40 rounded-lg border border-white/60 object-contain" />
        ) : null}
      </Field>
      <Field label="Voice note">
        <VoiceRecorder existingUrl={initial?.hasVoice ? `/api/files/expense/${initial.id}/voice` : null} onChange={(blob, dur) => setVoice(blob ? { blob, dur } : null)} />
      </Field>
      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? "Saving…" : initial ? "Save changes" : "Add expense"}
        </button>
        <button type="button" onClick={onDone} className={btnSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
