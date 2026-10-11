/**
 * "Edit draft" (owner request, prototype `editDraft`): map a draft invoice back into the wizard's form state so the
 * wizard can re-open it pre-filled. Pure and client-safe; `buildInvoiceInput(invoiceToForm(x))` reproduces the
 * draft's input (round-trip unit-tested).
 */
import { formatInTimeZone } from "date-fns-tz";
import type { InvoiceDetail } from "@/server/finance/queries";
import { dateKeyLocal } from "@/components/finance/finance-ui";
import { defaultPartsFor, emptyForm, type Frequency, type InvoiceFormState, type LineRow } from "@/components/finance/invoice-form-helpers";

export type DraftForEdit = Pick<
  InvoiceDetail,
  "id" | "status" | "approvedAt" | "number" | "clientId" | "docType" | "taxMode" | "plan" | "description" | "gstPercent" | "tdsApplicable" | "currency" | "dueDate" | "remindAt" | "notes" | "paymentTerms" | "createdAt"
> & {
  items: Pick<InvoiceDetail["items"][number], "description" | "hsnSac" | "qty" | "unit" | "rate" | "amount">[];
  schedule: Pick<NonNullable<InvoiceDetail["schedule"]>, "frequency" | "interval" | "monthAnchor" | "dayOfMonth" | "notifyMinutes" | "endDate"> & { nextRunAt?: string | null } | null;
  planRef: Pick<NonNullable<InvoiceDetail["planRef"]>, "gstPercent"> | null;
};

/** Only unnumbered drafts awaiting approval can be edited (the server checks the same and more). */
export function canEditDraft(inv: Pick<InvoiceDetail, "status" | "approvedAt" | "number" | "docType">): boolean {
  return inv.status === "AWAITING_APPROVAL" && !inv.approvedAt && inv.number.startsWith("DRAFT-") && inv.docType !== "CREDIT_NOTE";
}

/** yyyy-MM-dd of a stored date: dates entered as a day are UTC midnight; anything else is read in the company tz. */
export function dateKeyOf(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  if (/T00:00:00(\.000)?Z$/.test(iso)) return iso.slice(0, 10);
  return formatInTimeZone(new Date(iso), tz, "yyyy-MM-dd");
}

/** 540 → "09:00". */
export function minutesToHhmm(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.min(1439, Math.round(minutes ?? 540)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Inverse of `remindAtIso`: the browser-local date + HH:MM of a reminder instant. */
export function remindParts(iso: string | null | undefined): { remindDate: string; remindTime: string } {
  if (!iso) return { remindDate: "", remindTime: "09:00" };
  const d = new Date(iso);
  return { remindDate: dateKeyLocal(d), remindTime: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` };
}

/** One FIXED line at qty 1 that just repeats the description = the wizard's "single amount" shortcut. */
function isSingleAmount(inv: DraftForEdit): boolean {
  if (inv.items.length !== 1) return false;
  const it = inv.items[0];
  const desc = inv.description || "Services";
  return it.unit === "FIXED" && it.qty === 1 && !it.hsnSac && it.description === desc;
}

const lineOf = (it: DraftForEdit["items"][number]): LineRow => ({ description: it.description, hsnSac: it.hsnSac ?? "", qty: String(it.qty), unit: it.unit, rate: String(it.rate) });

function frequencyOf(f: string): { frequency: Frequency; daily: boolean } {
  if (f === "WEEKLY" || f === "MONTHLY" || f === "CUSTOM") return { frequency: f, daily: false };
  return { frequency: "CUSTOM", daily: true }; // DAILY = every 1 day
}

/**
 * Older monthly schedules (anchor NONE) repeat on the date they started, e.g. the 17th. The form has no "same date"
 * option, so show it as "on day 17" (capped at 28, past that the last day) instead of silently moving it to the 1st.
 */
function monthAnchorFields(r: NonNullable<DraftForEdit["schedule"]>, tz: string): Pick<InvoiceFormState, "monthAnchor" | "dayOfMonth"> {
  if (r.monthAnchor === "START" || r.monthAnchor === "END") return { monthAnchor: r.monthAnchor, dayOfMonth: String(r.dayOfMonth ?? 15) };
  if (r.monthAnchor === "DAY") return { monthAnchor: "DAY", dayOfMonth: String(r.dayOfMonth ?? 15) };
  const key = dateKeyOf(r.nextRunAt ?? null, tz);
  const day = key ? Number(key.slice(8, 10)) : NaN;
  if (!Number.isFinite(day)) return { monthAnchor: "START", dayOfMonth: "15" };
  if (day > 28) return { monthAnchor: "END", dayOfMonth: "28" };
  return { monthAnchor: "DAY", dayOfMonth: String(day) };
}

function recurrenceFields(inv: DraftForEdit, tz: string): Partial<InvoiceFormState> {
  const r = inv.schedule;
  if (!r) return {};
  const { frequency, daily } = frequencyOf(r.frequency);
  const dueDays = inv.dueDate ? Math.max(0, Math.round((new Date(inv.dueDate).getTime() - new Date(inv.createdAt).getTime()) / 86_400_000)) : 15;
  return {
    frequency,
    interval: String(daily ? 1 : Math.max(1, r.interval)),
    ...monthAnchorFields(r, tz),
    notifyTime: minutesToHhmm(r.notifyMinutes),
    infinite: !r.endDate,
    endDate: dateKeyOf(r.endDate, tz),
    dueDays: String(dueDays),
  };
}

/**
 * Wizard form state for an existing draft: client, single amount or line items, description, GST % (the plan's or
 * the company default when the draft is untaxed), TDS, currency, plan + recurrence, due date, reminder, proforma.
 * A part-payment draft becomes a single amount with `partEdit` (only the issued part is edited).
 */
export function invoiceToForm(inv: DraftForEdit, opts: { tz: string; defaultGst: number; paymentTerms?: string; today?: string }): InvoiceFormState {
  const base = emptyForm({ gstPercent: opts.defaultGst, paymentTerms: opts.paymentTerms ?? "", today: opts.today ?? dateKeyLocal() });
  const part = inv.plan === "PART";
  const single = part || isSingleAmount(inv);
  const subtotal = inv.items.reduce((s, it) => s + it.amount, 0);
  // Untaxed documents (proforma, export under LUT) store 0%; offer the plan's / company rate if they become taxed.
  const untaxed = inv.taxMode === "NONE" || inv.taxMode === "EXPORT_LUT";
  const gst = untaxed ? inv.planRef?.gstPercent || opts.defaultGst : inv.gstPercent;
  return {
    ...base,
    clientId: inv.clientId,
    amount: single ? String(Math.round(subtotal * 100) / 100) : "",
    description: inv.description,
    useLines: !single,
    lines: single ? [{ ...base.lines[0] }] : inv.items.map(lineOf),
    gstPercent: String(gst),
    plan: inv.plan,
    dueDate: dateKeyOf(inv.dueDate, opts.tz),
    ...(inv.plan === "RECURRING" ? recurrenceFields(inv, opts.tz) : {}),
    parts: part ? base.parts : defaultPartsFor(2, opts.today ?? dateKeyLocal()),
    ...(inv.plan === "RECURRING" ? {} : remindParts(inv.remindAt)),
    currency: inv.currency || "INR",
    proforma: inv.docType === "PROFORMA",
    tdsApplicable: inv.tdsApplicable,
    notes: inv.notes ?? "",
    paymentTerms: inv.paymentTerms ?? base.paymentTerms,
    partEdit: part,
  };
}
