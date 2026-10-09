"use client";
import { useState } from "react";
import { Field, inputCls } from "@/components/ui/Field";
import { segActive, segIdle } from "@/components/finance/finance-ui";
import type { OccRow } from "@/server/finance/payables-queries";
import { TAG, autoGst } from "@/components/finance/payables/payables-ui";

/**
 * "Bill & GST" block (prototype `gstBlock`): attach the vendor's bill (PDF / photo), "This bill includes GST",
 * rate pills 5 / 12 / 18 / 28 with the GST auto-computed as amount × rate / (100 + rate) (editable), vendor GSTIN and
 * "I'll get this GST back" (input tax credit → the month's GST pack).
 */
export type GstState = { has: boolean; rate: number; amt: number; manual: boolean; gstin: string; itc: boolean; file: File | null; existing: string | null; remove: boolean };

export function initialGst(o: OccRow | null, billGstin: string | null): GstState {
  const has = !!o && o.gstAmount > 0;
  return { has, rate: o?.gstRate || 18, amt: o?.gstAmount ?? 0, manual: has, gstin: o?.vendorGstin || billGstin || "", itc: o && has ? o.itcClaimable : true, file: null, existing: o?.hasBill ? o.billName || "bill" : null, remove: false };
}

/** GST amount actually used: the typed value once edited, else the auto value for `amount`. */
export const gstValue = (s: GstState, amount: number) => (s.has ? (s.manual ? s.amt : autoGst(amount, s.rate)) : 0);

export function gstPayload(s: GstState, amount: number) {
  return { includesGst: s.has, gstRate: s.has ? s.rate : null, gstAmount: s.has ? gstValue(s, amount) : null, vendorGstin: s.has ? s.gstin.trim() || null : null, itcClaimable: s.has && s.itc };
}

/** FormData with the chosen file under `bill`, or null when no new file was picked. */
export function billFiles(s: GstState): FormData | null {
  if (!s.file) return null;
  const fd = new FormData();
  fd.set("bill", s.file);
  return fd;
}

export function useGstState(o: OccRow | null, billGstin: string | null) {
  return useState<GstState>(() => initialGst(o, billGstin));
}

const MAX = 12 * 1024 * 1024;

export function GstBlock({ s, set, amount, onError }: { s: GstState; set: (s: GstState) => void; amount: number; onError: (msg: string) => void }) {
  const up = (p: Partial<GstState>) => set({ ...s, ...p });
  const shownName = s.file?.name ?? (s.remove ? null : s.existing);
  const value = gstValue(s, amount);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="glass-chip flex h-[34px] cursor-pointer items-center rounded-full px-3 text-xs font-medium text-gray-800">
          {shownName ? "📎 Replace bill" : "📎 Attach the bill (PDF / photo)"}
          <input
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0];
              if (!f) return;
              if (f.size > MAX) return onError("The bill is too large (max 12 MB)");
              up({ file: f, remove: false });
            }}
          />
        </label>
        {shownName ? <span className={TAG.paid}>✓ {shownName}</span> : null}
        {shownName ? (
          <button type="button" className="glass-chip rounded-full px-2 py-1 text-xs" aria-label="Remove the bill" onClick={() => up({ file: null, remove: !!s.existing })}>
            ✕
          </button>
        ) : null}
      </div>
      <label className="glass flex items-start gap-3 rounded-2xl px-3 py-2 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-blue" checked={s.has} onChange={(e) => up({ has: e.target.checked, manual: false })} />
        <span>
          <b className="block">This bill includes GST</b>
          <span className="block text-[11px] text-gray-500">GST is part of the amount above</span>
        </span>
      </label>
      {s.has ? (
        <div className="space-y-3">
          <Field label="GST rate">
            <div className="flex gap-1.5">
              {[5, 12, 18, 28].map((r) => (
                <button key={r} type="button" onClick={() => up({ rate: r, manual: false })} className={`rounded-full px-3 py-1 text-xs font-medium ${s.rate === r ? segActive : segIdle}`}>
                  {r}%
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="GST amount (₹)">
              <input className={inputCls} type="number" min="0" step="0.01" inputMode="decimal" value={value} onChange={(e) => up({ amt: Number(e.target.value) || 0, manual: true })} />
            </Field>
            <Field label="Vendor GSTIN">
              <input className={inputCls} placeholder="On their bill" value={s.gstin} onChange={(e) => up({ gstin: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          <label className="glass flex items-start gap-3 rounded-2xl px-3 py-2 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-blue" checked={s.itc} onChange={(e) => up({ itc: e.target.checked })} />
            <span>
              <b className="block">I&apos;ll get this GST back</b>
              <span className="block text-[11px] text-gray-500">Input tax credit · goes into the month&apos;s GST pack for your finance person</span>
            </span>
          </label>
          {s.itc && !shownName ? <p className="-mt-1 text-[11px] text-amber-700">Attach the bill: the claim needs the vendor&apos;s tax invoice in your business name</p> : null}
        </div>
      ) : null}
    </div>
  );
}
