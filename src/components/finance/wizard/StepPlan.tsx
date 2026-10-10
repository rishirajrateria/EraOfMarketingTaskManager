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

const ANCHORS: { value: "START" | "END" | "DAY"; label: string }[] = [
  { value: "START", label: "1st day" },
  { value: "END", label: "Last day" },
  { value: "DAY", label: "A date" },
];
const DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1));

/** Step 3 — plan: one time (due date + optional reminder) / recurring (frequency, day, notify time, end, due days) / part payment. */
export function StepPlan({ form, set, errors, edit }: StepProps) {
  const taxable = formTaxable(form);
  const seg = (active: boolean) => `touch-target flex-1 rounded-lg px-3 py-1.5 text-center text-sm ${active ? segActive : segIdle}`;
  const cards = PLAN_CARDS.filter((c) => !edit || edit.plans.includes(c.value));
  return (
    <div className="space-y-4 px-4 py-4">
      {edit && edit.plans.length === 1 ? (
        <p className="text-xs text-muted">
          {form.partEdit
            ? `${edit.partLabel ?? "This part"}: only this part changes here. Use Edit schedule on the invoice to change the other parts.`
            : "This is one occurrence of a recurring invoice, so it stays recurring. Changes to the schedule apply to the next ones."}
        </p>
      ) : null}
      <div className="grid gap-2">
        {cards.map((c) => {
          const active = form.plan === c.value;
          return (
            <button key={c.value} type="button" aria-pressed={active} onClick={() => set({ plan: c.value })} className={`flex items-center gap-3 rounded-2xl p-3 text-left transition ${active ? "glass-dark text-ink ring-2 ring-[#1e63d6]" : "glass text-ink"}`}>
              <span className="text-2xl">{c.icon}</span>
              <span>
                <span className="block text-base font-semibold">{c.title}</span>
                <span className="block text-xs text-muted">{c.hint}</span>
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
                {ANCHORS.map((a) => (
                  <button key={a.value} type="button" aria-pressed={form.monthAnchor === a.value} className={seg(form.monthAnchor === a.value)} onClick={() => set({ monthAnchor: a.value })}>{a.label}</button>
                ))}
              </div>
              {form.monthAnchor === "DAY" ? (
                <select className={`${inputSm} mt-2`} value={form.dayOfMonth} onChange={(e) => set({ dayOfMonth: e.target.value })} aria-label="Day of month">
                  {DAYS.map((d) => (
                    <option key={d} value={d}>Day {d} of every month</option>
                  ))}
                </select>
              ) : null}
            </Field>
          ) : null}
          <Field label="Notify me at" hint="The invoice is created and you get a notification at this time — nothing is sent until you approve it">
            <input type="time" step={300} value={form.notifyTime} onChange={(e) => e.target.value && set({ notifyTime: e.target.value })} className={inputSm} />
          </Field>
          <Toggle checked={form.infinite} onChange={(v) => set({ infinite: v })} label="Infinite" hint="Runs until you stop the recurrence" />
          {!form.infinite ? (
            <Field label="End date">
              <input type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} className={inputSm} />
            </Field>
          ) : null}
          <Field label="Due days after issue" hint="Each occurrence is due this many days after it is approved">
            <input type="number" min="0" max="365" value={form.dueDays} onChange={(e) => set({ dueDays: e.target.value, dueDate: addDaysKey(Number(e.target.value) || 0) })} className={inputSm} />
          </Field>
          {edit ? <p className="text-xs text-muted">Saving a changed schedule recalculates the next run from today.</p> : null}
          <FieldError error={errors.recurrence} />
        </div>
      ) : null}

      {form.plan === "PART" && form.partEdit ? (
        <Field label={`Due date${edit?.partLabel ? ` · ${edit.partLabel}` : ""}`} hint="The other parts keep their amounts and dates; the plan total follows this part's amount">
          <input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} className={inputCls} />
          <FieldError error={errors.dueDate} />
        </Field>
      ) : null}

      {form.plan === "PART" && !form.partEdit ? (
        <div>
          <PartsEditor parts={form.parts} total={taxable} onChange={(parts) => set({ parts })} label={`Parts of the taxable total (GST is added to each part)`} />
          <FieldError error={errors.parts} />
        </div>
      ) : null}

      {form.plan !== "RECURRING" ? (
        <div className="glass space-y-2 rounded-2xl p-3">
          <Field label="Remind me to approve and send on" hint="Optional. You get a notification then; nothing is sent automatically">
            <div className="flex gap-2">
              <input type="date" value={form.remindDate} onChange={(e) => set({ remindDate: e.target.value })} className={inputSm} aria-label="Reminder date" />
              <input type="time" step={300} value={form.remindTime} disabled={!form.remindDate} onChange={(e) => e.target.value && set({ remindTime: e.target.value })} className={`${inputSm} max-w-[120px] disabled:opacity-50`} aria-label="Reminder time" />
            </div>
          </Field>
          {form.remindDate ? (
            <button type="button" className="text-xs text-gray-500 underline" onClick={() => set({ remindDate: "" })}>Clear reminder</button>
          ) : null}
          <FieldError error={errors.remindAt} />
        </div>
      ) : null}
    </div>
  );
}
