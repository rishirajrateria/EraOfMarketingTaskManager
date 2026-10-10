"use client";
import { Field, inputCls } from "@/components/ui/Field";
import { Toggle } from "@/components/admin/AdminUi";
import { formatINR } from "@/server/finance/money";
import { TaxBadge } from "@/components/finance/TaxBadge";
import { formTaxable, partsSummary } from "@/components/finance/invoice-form-helpers";
import { describeMonthAnchor } from "@/server/finance/recurrence";
import { TotalsCard } from "@/components/finance/wizard/TotalsCard";
import { PLAN_CARDS } from "@/components/finance/wizard/StepPlan";
import { FieldError, type StepProps } from "@/components/finance/wizard/types";

const fmtKey = (k: string) => (k ? new Date(`${k}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "on receipt");

/** Step 4 — review everything, choose Proforma, notes / payment terms, then "Save (awaiting approval)". */
export function StepReview({ form, set, errors, clients, tax, edit }: StepProps) {
  const client = clients.find((c) => c.id === form.clientId);
  const plan = PLAN_CARDS.find((p) => p.value === form.plan)!;
  const taxable = formTaxable(form);
  const parts = form.plan === "PART" && !form.partEdit ? partsSummary(form.parts, taxable) : null;
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-gray-500">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
  return (
    <div className="space-y-4 px-4 py-4">
      <div className="glass space-y-1.5 rounded-2xl p-3">
        <Row k="Client" v={<b>{client?.name ?? "—"}</b>} />
        <Row k="Document" v={tax ? <TaxBadge tax={tax} /> : "—"} />
        <Row k="Plan" v={`${plan.icon} ${plan.title}`} />
        <Row k="TDS" v={form.tdsApplicable ? `Client deducts TDS${client?.tdsPercent != null ? ` (${client.tdsPercent}%)` : ""}` : "Not deducted"} />
        {form.currency && form.currency !== "INR" ? <Row k="Currency" v={form.currency} /> : null}
        {form.plan === "ONE_TIME" ? <Row k="Due" v={fmtKey(form.dueDate)} /> : null}
        {form.partEdit ? <Row k={edit?.partLabel ?? "Part"} v={`due ${fmtKey(form.dueDate)}`} /> : null}
        {form.plan === "RECURRING" ? (
          <Row k="Repeats" v={`${form.frequency === "CUSTOM" ? `every ${form.interval} days` : form.frequency === "MONTHLY" ? `monthly on ${describeMonthAnchor(form.monthAnchor, Number(form.dayOfMonth))}` : "weekly"} at ${form.notifyTime || "09:00"}${form.infinite ? " · infinite" : ` · until ${fmtKey(form.endDate)}`} · due +${form.dueDays || 0}d`} />
        ) : null}
        {form.plan !== "RECURRING" && form.remindDate ? <Row k="Reminder" v={`${fmtKey(form.remindDate)} at ${form.remindTime || "09:00"}`} /> : null}
        {parts ? (
          <div className="pt-1 text-sm">
            <div className="text-gray-500">Parts</div>
            <ul className="mt-1 space-y-0.5 text-xs text-gray-700">
              {form.parts.map((p, i) => (
                <li key={i} className="flex justify-between">
                  <span>Part {i + 1} · {fmtKey(p.dueDate)}{p.description ? ` · ${p.description}` : ""}</span>
                  <span>{formatINR(parts.amounts[i] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="pt-1 text-sm">
          <div className="text-gray-500">Description</div>
          <div className="whitespace-pre-wrap text-gray-800">{form.description || (form.useLines ? form.lines.map((l) => l.description).filter(Boolean).join(", ") : "—")}</div>
        </div>
      </div>
      <TotalsCard form={form} taxMode={tax?.taxMode ?? "CGST_SGST"} compact />
      {form.partEdit ? null : (
        <div className="glass rounded-2xl px-3">
          <Toggle checked={form.proforma} onChange={(v) => set({ proforma: v })} label={edit ? "Make it a Proforma" : "Create as Proforma instead"} hint="No tax, no series number; convert to the tax invoice later" />
        </div>
      )}
      <Field label="Payment terms" hint="From Settings; printed on the PDF">
        <textarea rows={2} value={form.paymentTerms} onChange={(e) => set({ paymentTerms: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} className={inputCls} />
      </Field>
      {Object.entries(errors).map(([k, v]) => (
        <FieldError key={k} error={`${k}: ${v}`} />
      ))}
      <p className="text-xs text-gray-500">
        {edit ? "Saving updates this draft; it stays awaiting approval and nothing is sent." : "Nothing is sent now. The document waits for your approval, where you confirm Email and WhatsApp."}
      </p>
    </div>
  );
}
