/**
 * Pure helpers for the "New invoice" wizard (no React, no server imports) so they can be unit-tested.
 * `buildInvoiceInput` shapes the form state exactly like `invoiceInputSchema` expects.
 */
import { computeTotals, round2 } from "@/server/finance/money";
import { effectiveGstPercent, resolveTax, splitTax, type TaxClient, type TaxMode, type TaxResolution } from "@/server/finance/tax";

export type LineRow = { description: string; hsnSac: string; qty: string; unit: "HOURS" | "FIXED"; rate: string };
export type PartRow = { kind: "PERCENT" | "FIXED"; value: string; dueDate: string; description: string };
export type Frequency = "WEEKLY" | "MONTHLY" | "CUSTOM";

export type InvoiceFormState = {
  clientId: string;
  amount: string;
  description: string;
  useLines: boolean;
  lines: LineRow[];
  gstPercent: string;
  plan: "ONE_TIME" | "RECURRING" | "PART";
  dueDate: string;
  frequency: Frequency;
  interval: string;
  /** ADR 0007: 1st / last day / a chosen day (`dayOfMonth`, 1–28) at `notifyTime` (HH:MM, company tz). */
  monthAnchor: "START" | "END" | "DAY";
  dayOfMonth: string;
  notifyTime: string;
  endDate: string;
  infinite: boolean;
  dueDays: string;
  parts: PartRow[];
  /** ADR 0007: non-recurring documents — "remind me to approve and send on" (date + HH:MM, blank = none). */
  remindDate: string;
  remindTime: string;
  /** ADR 0007: ISO 4217 printed on the PDF; follows the client (INR for Indian clients). */
  currency: string;
  proforma: boolean;
  /** ADR 0006: the client deducts TDS on this invoice (defaults to "has a TDS %" when a client is picked). */
  tdsApplicable: boolean;
  notes: string;
  paymentTerms: string;
  /** Editing a part-payment draft: only the issued part changes (one amount + `dueDate`); the schedule stays. */
  partEdit: boolean;
};

export const emptyLine = (): LineRow => ({ description: "", hsnSac: "", qty: "1", unit: "FIXED", rate: "" });

export function emptyForm(defaults: { gstPercent: number; paymentTerms: string; today: string }): InvoiceFormState {
  return {
    clientId: "",
    amount: "",
    description: "",
    useLines: false,
    lines: [emptyLine()],
    gstPercent: String(defaults.gstPercent),
    plan: "ONE_TIME",
    dueDate: "",
    frequency: "MONTHLY",
    interval: "1",
    monthAnchor: "START",
    dayOfMonth: "15",
    notifyTime: "09:00",
    endDate: "",
    infinite: true,
    dueDays: "15",
    parts: defaultPartsFor(2, defaults.today),
    remindDate: "",
    remindTime: "09:00",
    currency: "INR",
    proforma: false,
    tdsApplicable: false,
    notes: "",
    paymentTerms: defaults.paymentTerms,
    partEdit: false,
  };
}

const num = (s: string): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** yyyy-MM-dd shifted by `days` (calendar arithmetic on the key, timezone-free). */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** `n` equal percent parts; the first is due today, the rest 30 days apart. Rounds so they sum to exactly 100. */
export function defaultPartsFor(n: number, today: string): PartRow[] {
  const count = Math.max(1, Math.floor(n));
  const base = Math.floor((100 / count) * 100) / 100;
  const rows: PartRow[] = [];
  let allocated = 0;
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    const value = last ? round2(100 - allocated) : base;
    allocated = round2(allocated + value);
    rows.push({ kind: "PERCENT", value: String(value), dueDate: shiftDateKey(today, 30 * i), description: "" });
  }
  return rows;
}

export type PartsSummary = { allocated: number; remaining: number; percent: number; valid: boolean; amounts: number[]; error: string | null };

/**
 * Resolve % / ₹ parts against the taxable total; valid when they add up to it (±0.01) and every row is positive
 * with a date. `percentBase` (default `total`) is what percent parts are a share of — the plan total when only
 * the remaining pending parts are being edited.
 */
export function partsSummary(parts: PartRow[], total: number, percentBase = total): PartsSummary {
  const amounts = parts.map((p) => round2(p.kind === "PERCENT" ? (percentBase * num(p.value)) / 100 : num(p.value)));
  const allocated = round2(amounts.reduce((s, a) => s + a, 0));
  const remaining = round2(total - allocated);
  const percent = total > 0 ? round2((allocated / total) * 100) : 0;
  let error: string | null = null;
  if (parts.length === 0) error = "Add at least one part";
  else if (parts.some((p) => num(p.value) <= 0)) error = "Every part needs a positive amount";
  else if (parts.some((p) => !p.dueDate)) error = "Every part needs a due date";
  else if (total <= 0) error = "Enter the invoice amount first";
  else if (Math.abs(remaining) > 0.01) error = remaining > 0 ? `${formatShort(remaining)} still unallocated` : `Over-allocated by ${formatShort(-remaining)}`;
  return { allocated, remaining, percent, valid: error === null, amounts, error };
}

function formatShort(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Taxable subtotal of the form (single amount or line items). */
export function formTaxable(f: Pick<InvoiceFormState, "useLines" | "lines" | "amount">): number {
  if (!f.useLines) return round2(num(f.amount));
  return computeTotals(
    f.lines.map((l) => ({ qty: num(l.qty), unit: l.unit, rate: num(l.rate) })),
    0,
  ).subtotal;
}

export type ClientForTax = TaxClient & { id: string };

/** Tax resolution for the picked client (proforma opt-in), or null when no client is picked. */
export function formTax(f: Pick<InvoiceFormState, "clientId" | "proforma">, clients: ClientForTax[], companyStateCode: string | null): TaxResolution | null {
  const client = clients.find((c) => c.id === f.clientId);
  if (!client) return null;
  return resolveTax({ companyStateCode, client, wanted: f.proforma ? "PROFORMA" : null });
}

/** Live totals card: taxable + split tax for the resolved mode. */
export function formTotals(f: Pick<InvoiceFormState, "useLines" | "lines" | "amount" | "gstPercent">, taxMode: TaxMode) {
  const taxable = formTaxable(f);
  const gst = effectiveGstPercent(num(f.gstPercent), taxMode);
  return { taxable, gstPercent: gst, ...splitTax(taxable, gst, taxMode) };
}

/** "Tax Invoice · CGST+SGST" / "Tax Invoice · IGST" / "Export Invoice · 0% under LUT" / "Proforma · No tax". */
export function taxBadgeLabel(t: TaxResolution): string {
  const doc = t.docType === "EXPORT_INVOICE" ? "Export Invoice" : t.docType === "PROFORMA" ? "Proforma" : t.docType === "CREDIT_NOTE" ? "Credit note" : "Tax Invoice";
  const mode = t.taxMode === "CGST_SGST" ? "CGST+SGST" : t.taxMode === "IGST" ? "IGST" : t.taxMode === "EXPORT_LUT" ? "0% under LUT" : "No tax";
  return `${doc} · ${mode}`;
}

/** Field-level validation before calling the action; keys match `invoiceInputSchema` paths. */
export function validateForm(f: InvoiceFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.clientId) errors.clientId = "Pick a client";
  const taxable = formTaxable(f);
  if (taxable <= 0) errors[f.useLines ? "items" : "amount"] = f.useLines ? "Add at least one line with an amount" : "Enter an amount";
  if (!f.useLines && !f.description.trim()) errors.description = "Describe what this invoice is for";
  if (f.useLines && f.lines.some((l) => !l.description.trim() && num(l.rate) > 0)) errors.items = "Every line needs a description";
  if (f.plan === "RECURRING" && !f.infinite && !f.endDate) errors.recurrence = "Pick an end date or choose Infinite";
  if (f.plan === "RECURRING" && num(f.interval) < 1) errors.recurrence = "Interval must be at least 1";
  if (f.plan === "RECURRING" && f.frequency === "MONTHLY" && f.monthAnchor === "DAY" && (num(f.dayOfMonth) < 1 || num(f.dayOfMonth) > 28)) errors.recurrence = "Pick a day between 1 and 28";
  if (f.plan !== "RECURRING" && f.remindDate && !/^\d{4}-\d{2}-\d{2}$/.test(f.remindDate)) errors.remindAt = "Pick a valid reminder date";
  if (f.plan === "PART" && f.proforma) errors.parts = "A proforma can't be split into parts — use one time or recurring";
  if (f.plan === "PART" && f.partEdit && f.useLines && f.lines.filter((l) => l.description.trim() || num(l.rate) > 0).length > 1) errors.items = "A part payment is billed as one amount — switch off line items";
  if (f.plan === "PART" && !f.partEdit) {
    const s = partsSummary(f.parts, taxable);
    if (!s.valid && s.error) errors.parts = s.error;
  }
  return errors;
}

/** "09:00" → 540. */
export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return Math.max(0, Math.min(1439, (h || 0) * 60 + (m || 0)));
}

/** Local date + HH:MM from the wizard → ISO instant (the browser's zone, i.e. the admin's), or null. */
export function remindAtIso(date: string, time: string): string | null {
  if (!date) return null;
  const d = new Date(`${date}T${/^\d{2}:\d{2}$/.test(time) ? time : "09:00"}:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Shape the wizard state into the `createInvoice` input (strings → numbers, blanks → null). */
export function buildInvoiceInput(f: InvoiceFormState) {
  const items = f.useLines
    ? f.lines.filter((l) => l.description.trim() || num(l.rate) > 0).map((l) => ({ description: l.description.trim(), hsnSac: l.hsnSac.trim() || null, qty: l.unit === "FIXED" ? 1 : num(l.qty) || 1, unit: l.unit, rate: num(l.rate) }))
    : undefined;
  const recurrence =
    f.plan === "RECURRING"
      ? {
          frequency: f.frequency,
          interval: f.frequency === "CUSTOM" ? Math.max(1, Math.round(num(f.interval))) : 1,
          byWeekday: [] as number[],
          monthAnchor: f.frequency === "MONTHLY" ? f.monthAnchor : ("NONE" as const),
          dayOfMonth: f.frequency === "MONTHLY" && f.monthAnchor === "DAY" ? Math.round(num(f.dayOfMonth)) : null,
          notifyMinutes: hhmmToMinutes(f.notifyTime || "09:00"),
          endDate: f.infinite ? null : f.endDate || null,
        }
      : null;
  const parts = f.plan === "PART" && !f.partEdit ? f.parts.map((p) => ({ kind: p.kind, value: num(p.value), dueDate: p.dueDate, description: p.description.trim() })) : null;
  const dueDate = f.plan === "ONE_TIME" ? f.dueDate || null : f.plan === "RECURRING" || f.partEdit ? f.dueDate || null : f.parts[0]?.dueDate || null;
  return {
    clientId: f.clientId,
    docType: f.proforma ? ("PROFORMA" as const) : null,
    plan: f.plan,
    items,
    amount: f.useLines ? null : num(f.amount),
    gstPercent: num(f.gstPercent),
    description: f.description.trim(),
    notes: f.notes.trim() || null,
    paymentTerms: f.paymentTerms.trim() || null,
    dueDate,
    recurrence,
    parts,
    tdsApplicable: f.tdsApplicable,
    currency: f.currency.trim().toUpperCase() || null,
    remindAt: f.plan === "RECURRING" ? null : remindAtIso(f.remindDate, f.remindTime),
  };
}

/**
 * Fill `{{var}}` placeholders. Unknown keys are left untouched so the server can fill them at send time
 * (e.g. `{{number}}` before approval and `{{link}}`, whose token rotates on every approval).
 */
export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => (vars[k] != null ? vars[k]! : m));
}

/** Map "field: message; field2: message" (the server's zod format) into per-field errors + the rest. */
export function splitActionError(error: string): { fields: Record<string, string>; rest: string } {
  const fields: Record<string, string> = {};
  const rest: string[] = [];
  for (const piece of error.split(";")) {
    const m = piece.trim().match(/^([A-Za-z0-9_.]+):\s*(.+)$/);
    if (m) fields[m[1].split(".")[0]] = m[2];
    else if (piece.trim()) rest.push(piece.trim());
  }
  return { fields, rest: rest.join("; ") };
}

/** Which client-contact channels are missing for sending. */
export function contactWarnings(c: { email?: string | null; whatsapp?: string | null }): string[] {
  const out: string[] = [];
  if (!c.email) out.push("No email on file");
  if (!c.whatsapp) out.push("No WhatsApp number");
  return out;
}
