"use client";
import { useState } from "react";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { createExpense, updateExpense } from "@/server/finance/expenses";
import type { ExpenseRow } from "@/server/finance/queries";
import { VoiceRecorder } from "@/components/finance/VoiceRecorder";

/** Add / edit expense sheet body (SPEC §11.2): bill photo via camera, voice note via MediaRecorder. */
export function ExpenseForm({ initial, categories, onDone }: { initial?: ExpenseRow | null; categories: string[]; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<{ blob: Blob; dur: number } | null>(null);
  const [preview, setPreview] = useState<string | null>(initial?.hasReceipt ? `/api/files/expense/${initial.id}/receipt` : null);

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
    onDone();
  }

  const dateValue = initial ? initial.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <input name="date" type="date" required defaultValue={dateValue} className={inputCls} />
        </Field>
        <Field label="Amount (₹)">
          <input name="amount" type="number" step="0.01" min="0" required defaultValue={initial?.amount} className={inputCls} inputMode="decimal" />
        </Field>
      </div>
      <Field label="Category">
        <input name="category" list="expense-categories" required defaultValue={initial?.category} className={inputCls} placeholder="Travel, Software, Office…" />
        <datalist id="expense-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="Vendor">
        <input name="vendor" defaultValue={initial?.vendor ?? ""} className={inputCls} />
      </Field>
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
          <img src={preview} alt="Receipt" className="mt-2 max-h-40 rounded-lg border object-contain" />
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
