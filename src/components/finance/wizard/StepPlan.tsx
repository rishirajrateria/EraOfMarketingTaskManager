"use client";
import { Field, inputCls } from "@/components/ui/Field";
import { Toggle } from "@/components/admin/AdminUi";
import { addDaysKey, inputSm, segActive, segIdle, type PlanKind } from "@/components/finance/finance-ui";
import { formTaxable, type Frequency } from "@/components/finance/invoice-form-helpers";
import { PartsEditor } from "@/components/finance/wizard/PartsEditor";
import { FieldError, type StepProps } from "@/components/finance/wizard/types";

export const PLAN_CARDS: { value: PlanKind; title: string; hint: string; icon: string }[] = [
  { value: "ONE_TIME", title: "One time", hint: "A single invoice with a due date", icon: "🧾" },
  { value: "RECURRING", title: "Recurring", hint: "Weekly, monthly or every N days — each one waits for your approval", icon: "🔁" },
  { value: "PART", title: "Part payment", hint: "Split into parts, each issued on its due date", icon: "🧩" },
];

const FREQS: { value: Frequency; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "CUSTOM", label: "Custom days" },
];

/** Step 3 — plan: one time (due date) / recurring (frequency, anchor, end, due days) / part payment (parts editor). */
export function StepPlan({ form, set, errors }: StepProps) {
  const taxable = formTaxable(form);
  const seg = (active: boolean) => `touch-target flex-1 rounded-lg px-3 py-1.5 text-center text-sm ${active ? segActive : segIdle}`;
  return (
    <div className="space-y-4 px-4 py-4">
      <div className="grid gap-2">
        {PLAN_CARDS.map((c) => {
          const active = form.plan === c.value;
          return (
            <button key={c.value} type="button" aria-pressed={active} onClick={() => set({ plan: c.value })} className={`flex items-center gap-3 rounded-2xl p-3 text-left transition ${active ? "glass-dark text-white" : "glass text-gray-900"}`}>
              <span className="text-2xl">{c.icon}</span>
              <span>
                <span className="block text-base font-semibold">{c.title}</span>
                <span className={`block text-xs ${active ? "opacity-80" : "text-gray-500"}`}>{c.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {form.plan === "ONE_TIME" ? (
        <Field label="Due date" hint="Leave empty for 'due on receipt'">
          <input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className={inputCls} />
          <FieldError error={errors.dueDate} />
        </Field>
      ) : null}

      {form.plan === "RECURRING" ? (
        <div className="glass space-y-3 rounded-2xl p-3">
          <Field label="Frequency">
            <div className="flex gap-2">
              {FREQS.map((f) => (
                <button key={f.value} type="button" aria-pressed={form.frequency === f.value} className={seg(form.frequency === f.value)} onClick={() => set({ frequency: f.value })}>{f.label}</button>
              ))}
            </div>
          </Field>
          {form.frequency === "CUSTOM" ? (
            <Field label="Every N days">
              <input type="number" min="1" max="365" value={form.interval} onChange={(e) => set({ interval: e.target.value })} className={inputSm} />
            </Field>
          ) : null}
          {form.frequency === "MONTHLY" ? (
            <Field label="Bill on">
              <div className="flex gap-2">
                <button type="button" aria-pressed={form.monthAnchor === "START"} className={seg(form.monthAnchor === "START")} onClick={() => set({ monthAnchor: "START" })}>1st of month</button>
                <button type="button" aria-pressed={form.monthAnchor === "END"} className={seg(form.monthAnchor === "END")} onClick={() => set({ monthAnchor: "END" })}>Last day of month</button>
              </div>
            </Field>
          ) : null}
          <Toggle checked={form.infinite} onChange={(v) => set({ infinite: v })} label="Infinite" hint="Runs until you stop the recurrence" />
          {!form.infinite ? (
            <Field label="End date">
              <input type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} className={inputSm} />
            </Field>
          ) : null}
          <Field label="Due days after issue" hint="Each occurrence is due this many days after it is approved">
            <input type="number" min="0" max="365" value={form.dueDays} onChange={(e) => set({ dueDays: e.target.value, dueDate: addDaysKey(Number(e.target.value) || 0) })} className={inputSm} />
          </Field>
          <FieldError error={errors.recurrence} />
        </div>
      ) : null}

      {form.plan === "PART" ? (
        <div>
          <PartsEditor parts={form.parts} total={taxable} onChange={(parts) => set({ parts })} label={`Parts of the taxable total (GST is added to each part)`} />
          <FieldError error={errors.parts} />
        </div>
      ) : null}
    </div>
  );
}
