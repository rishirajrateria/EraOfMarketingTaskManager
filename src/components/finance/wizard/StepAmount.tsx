"use client";
import { Field, inputCls } from "@/components/ui/Field";
import { Toggle } from "@/components/admin/AdminUi";
import { effectiveGstPercent } from "@/server/finance/tax";
import { CURRENCIES } from "@/components/finance/finance-ui";
import { LineItemsEditor } from "@/components/finance/wizard/LineItemsEditor";
import { TotalsCard } from "@/components/finance/wizard/TotalsCard";
import { FieldError, type StepProps } from "@/components/finance/wizard/types";

/** Step 2 — amount (taxable) + description, or line items; GST % (locked for export / proforma); live totals. */
export function StepAmount({ form, set, errors, tax, clients }: StepProps) {
  const taxMode = tax?.taxMode ?? "CGST_SGST";
  const gstLocked = taxMode === "EXPORT_LUT" || taxMode === "NONE";
  const abroad = (clients.find((c) => c.id === form.clientId)?.country ?? "IN").toUpperCase() !== "IN";
  const unit = form.currency && form.currency !== "INR" ? form.currency : "₹";
  return (
    <div className="space-y-4 px-4 py-4">
      {abroad ? (
        <Field label="Currency" hint="Printed on the export invoice; amounts are entered as-is (no conversion)">
          <select className={inputCls} value={form.currency || "INR"} onChange={(e) => set({ currency: e.target.value })}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      ) : null}
      {!form.useLines ? (
        <Field label={`Amount (taxable, ${unit})`}>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder="0.00"
            className={`${inputCls} text-2xl font-bold tracking-tight`}
            autoFocus
          />
          <FieldError error={errors.amount} />
        </Field>
      ) : null}
      <Field label="Description" hint="Printed on the invoice">
        <textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} className={inputCls} placeholder="e.g. Social media management — October 2026" />
        <FieldError error={errors.description} />
      </Field>
      {form.partEdit ? null : (
        <div className="glass rounded-2xl px-3">
          <Toggle checked={form.useLines} onChange={(v) => set({ useLines: v })} label="Add line items instead" hint="Description, HSN/SAC, qty, hours or fixed, rate" />
        </div>
      )}
      {form.useLines ? (
        <div>
          <LineItemsEditor lines={form.lines} onChange={(lines) => set({ lines })} />
          <FieldError error={errors.items} />
        </div>
      ) : null}
      <Field label="GST %" hint={gstLocked ? (taxMode === "EXPORT_LUT" ? "Export: 0% under LUT" : "Proforma: no tax") : undefined}>
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          inputMode="decimal"
          disabled={gstLocked}
          value={gstLocked ? String(effectiveGstPercent(0, taxMode)) : form.gstPercent}
          onChange={(e) => set({ gstPercent: e.target.value })}
          className={`${inputCls} disabled:opacity-60`}
        />
      </Field>
      <TotalsCard form={form} taxMode={taxMode} />
    </div>
  );
}
