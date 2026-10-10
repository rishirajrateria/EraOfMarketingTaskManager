"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search } from "lucide-react";
import { BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { SheetButtons } from "@/components/ui/CloseX";
import { btnPrimary, btnSecondary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { createInvoice, updateDraftInvoice, type UpdateDraftResult } from "@/server/finance/invoices";
import { dateKeyLocal } from "@/components/finance/finance-ui";
import { buildInvoiceInput, defaultPartsFor, emptyForm, formTax, splitActionError, validateForm, type InvoiceFormState } from "@/components/finance/invoice-form-helpers";
import { STEP_FIELDS, type ClientOpt, type WizardEditInfo } from "@/components/finance/wizard/types";
import { StepClient } from "@/components/finance/wizard/StepClient";
import { StepAmount } from "@/components/finance/wizard/StepAmount";
import { PLAN_CARDS, StepPlan } from "@/components/finance/wizard/StepPlan";
import { StepReview } from "@/components/finance/wizard/StepReview";

const TITLES = ["Client", "Amount", "Plan", "Review"];

/** Edit mode: the draft's id, its form state (`invoiceToForm`) and what may change. */
export type WizardEdit = WizardEditInfo & { id: string; initial: InvoiceFormState };

type Props = {
  clients: ClientOpt[];
  companyStateCode: string | null;
  defaults: { gstPercent: number; paymentTerms: string };
  onClose: () => void;
  /** "Edit draft": opens at the Amount step pre-filled; "Save changes" calls `updateDraftInvoice`, then `onSaved`. */
  edit?: WizardEdit | null;
  onSaved?: (res: UpdateDraftResult) => void;
};

/** "+ New invoice" / "Edit draft": four thumb-reach steps inside a full-screen Sheet; saves as AWAITING_APPROVAL (never sends). */
export function InvoiceWizard({ clients, companyStateCode, defaults, onClose, edit = null, onSaved }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [step, setStep] = useState(edit ? 2 : 1);
  const [query, setQuery] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState<InvoiceFormState>(() => edit?.initial ?? emptyForm({ gstPercent: defaults.gstPercent, paymentTerms: defaults.paymentTerms, today: dateKeyLocal() }));
  const plans = edit?.plans ?? PLAN_CARDS.map((c) => c.value);
  const set = (patch: Partial<InvoiceFormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (Object.keys(errors).length) setErrors({});
  };
  const tax = useMemo(() => formTax(form, clients, companyStateCode), [form, clients, companyStateCode]);

  const check = (upTo: number) => {
    const all = validateForm(form);
    const keys = new Set(Object.values(STEP_FIELDS).slice(0, upTo).flat());
    const errs = Object.fromEntries(Object.entries(all).filter(([k]) => upTo >= 4 || keys.has(k)));
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };
  const next = () => {
    if (!check(step)) return;
    setStep((s) => Math.min(4, s + 1));
  };
  const save = () => {
    if (!check(4)) return toast("Please fix the highlighted fields", "err");
    start(async () => {
      if (edit) {
        const res = await updateDraftInvoice(edit.id, buildInvoiceInput(form));
        if (!res.ok) {
          const { fields, rest } = splitActionError(res.error);
          setErrors(fields);
          toast(rest || res.error, "err");
          return;
        }
        toast("Draft updated · still awaiting approval");
        onSaved?.(res.data);
        return;
      }
      const res = await createInvoice(buildInvoiceInput(form));
      if (!res.ok) {
        const { fields, rest } = splitActionError(res.error);
        setErrors(fields);
        toast(rest || res.error, "err");
        return;
      }
      toast(form.plan === "PART" ? "Part 1 saved — awaiting approval" : "Saved — awaiting approval");
      onClose();
      router.push(`/admin/invoices/${res.data.id}`);
    });
  };

  const stepProps = { form, set, errors, clients, tax, edit };
  const rows =
    step === 2 && !form.partEdit ? (
      <ZoneRow label="Amount mode">
        <ZonePill active={!form.useLines} onClick={() => set({ useLines: false })}>Single amount</ZonePill>
        <ZonePill active={form.useLines} onClick={() => set({ useLines: true })}>Line items</ZonePill>
      </ZoneRow>
    ) : step === 3 ? (
      <>
        {plans.length > 1 ? (
          <ZoneRow label="Plan">
            {PLAN_CARDS.filter((c) => plans.includes(c.value)).map((c) => (
              <ZonePill key={c.value} active={form.plan === c.value} onClick={() => set({ plan: c.value })}>{c.title}</ZonePill>
            ))}
          </ZoneRow>
        ) : null}
        {form.plan === "RECURRING" && form.frequency === "MONTHLY" ? (
          <ZoneRow label="Bill on">
            <ZonePill active={form.monthAnchor === "START"} onClick={() => set({ monthAnchor: "START" })}>1st day</ZonePill>
            <ZonePill active={form.monthAnchor === "END"} onClick={() => set({ monthAnchor: "END" })}>Last day</ZonePill>
            <ZonePill active={form.monthAnchor === "DAY"} onClick={() => set({ monthAnchor: "DAY" })}>A date</ZonePill>
          </ZoneRow>
        ) : form.plan === "PART" && !form.partEdit ? (
          <ZoneRow label="Part presets">
            {[2, 3, 4].map((n) => (
              <ZonePill key={n} active={form.parts.length === n && form.parts.every((p) => p.kind === "PERCENT")} onClick={() => set({ parts: defaultPartsFor(n, dateKeyLocal()) })}>{n} equal parts</ZonePill>
            ))}
          </ZoneRow>
        ) : null}
      </>
    ) : step === 4 && !form.partEdit ? (
      <ZoneRow label="Document type">
        <ZonePill active={!form.proforma} onClick={() => set({ proforma: false })}>{tax?.docType === "EXPORT_INVOICE" || (form.proforma && tax?.placeOfSupply.startsWith("Outside")) ? "Export Invoice" : "Tax Invoice"}</ZonePill>
        <ZonePill active={form.proforma} onClick={() => set({ proforma: true })}>Proforma</ZonePill>
      </ZoneRow>
    ) : null;

  return (
    <div className="flex h-full min-h-full flex-col">
      <div className="sticky top-0 z-10 flex items-center gap-2 bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 px-4 py-3 text-white backdrop-blur-xl">
        <div className="flex-1">
          <div className="text-[11px] uppercase opacity-80">{edit ? `Step ${step} of 4 · ${TITLES[step - 1]}` : `New invoice · step ${step} of 4`}</div>
          <h2 className="text-base font-semibold">{edit ? "Edit draft" : TITLES[step - 1]}</h2>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {step === 1 ? <StepClient {...stepProps} query={query} /> : null}
        {step === 2 ? <StepAmount {...stepProps} /> : null}
        {step === 3 ? <StepPlan {...stepProps} /> : null}
        {step === 4 ? <StepReview {...stepProps} /> : null}
      </div>
      <BottomZone
        menu={false}
        strip={
          step === 1 ? (
            <label className="flex flex-1 items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-sm">
              <Search size={14} className="text-gray-500" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clients" className="w-full bg-transparent text-sm outline-none" aria-label="Search clients" />
            </label>
          ) : undefined
        }
        rows={rows}
        actions={
          // Step 1: [Next ———]; later: [Back] [Next ———] — the bottom nav's corner × closes the wizard (ADR 0016 addendum).
          <SheetButtons>
            {step > 1 ? (
              <button type="button" onClick={() => setStep((s) => s - 1)} className={btnSecondary}>
                <ChevronLeft size={16} aria-hidden /> Back
              </button>
            ) : null}
            {step < 4 ? (
              <button type="button" onClick={next} className={btnPrimary}>
                Next
              </button>
            ) : (
              <button type="button" onClick={save} disabled={pending} title={edit ? undefined : "Saved as awaiting approval — never sent"} className={btnPrimary}>
                {pending ? "Saving…" : edit ? "Save changes" : "Save for approval"}
              </button>
            )}
          </SheetButtons>
        }
      />
    </div>
  );
}
