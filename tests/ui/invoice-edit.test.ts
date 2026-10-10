import { describe, expect, it } from "vitest";
import { buildInvoiceInput, emptyForm, remindAtIso, validateForm, type InvoiceFormState } from "@/components/finance/invoice-form-helpers";
import { canEditDraft, dateKeyOf, invoiceToForm, minutesToHhmm, remindParts, type DraftForEdit } from "@/components/finance/invoice-edit-helpers";
import { invoiceInputSchema, invoiceUpdateSchema } from "@/server/finance/schemas";

const TZ = "Asia/Kolkata";
const TODAY = "2026-10-10";
const OPTS = { tz: TZ, defaultGst: 18, paymentTerms: "Net 15", today: TODAY };

const draft = (over: Partial<DraftForEdit> = {}): DraftForEdit => ({
  id: "inv1",
  status: "AWAITING_APPROVAL",
  approvedAt: null,
  number: "DRAFT-inv1",
  clientId: "c1",
  docType: "TAX_INVOICE",
  taxMode: "CGST_SGST",
  plan: "ONE_TIME",
  description: "October retainer",
  gstPercent: 18,
  tdsApplicable: true,
  currency: "INR",
  dueDate: "2026-11-15T00:00:00.000Z",
  remindAt: null,
  notes: null,
  paymentTerms: "Net 15",
  createdAt: "2026-10-10T05:00:00.000Z",
  items: [{ description: "October retainer", hsnSac: null, qty: 1, unit: "FIXED", rate: 25000, amount: 25000 }],
  schedule: null,
  planRef: null,
  ...over,
});

/** What the server stores for a wizard input (the inverse direction of the round trip). */
function stored(f: InvoiceFormState, over: Partial<DraftForEdit> = {}): DraftForEdit {
  const input = invoiceInputSchema.parse(buildInvoiceInput(f));
  const items = input.items?.length
    ? input.items.map((i) => ({ description: i.description, hsnSac: i.hsnSac ?? null, qty: i.qty, unit: i.unit, rate: i.rate, amount: i.qty * i.rate }))
    : [{ description: input.description || "Services", hsnSac: null, qty: 1, unit: "FIXED" as const, rate: input.amount ?? 0, amount: input.amount ?? 0 }];
  const r = input.recurrence;
  return draft({
    clientId: input.clientId,
    docType: input.docType === "PROFORMA" ? "PROFORMA" : "TAX_INVOICE",
    taxMode: input.docType === "PROFORMA" ? "NONE" : "CGST_SGST",
    plan: input.plan,
    description: input.description,
    gstPercent: input.docType === "PROFORMA" ? 0 : (input.gstPercent ?? 18),
    tdsApplicable: input.tdsApplicable ?? false,
    currency: input.currency ?? "INR",
    dueDate: input.dueDate?.toISOString() ?? null,
    remindAt: input.remindAt?.toISOString() ?? null,
    notes: input.notes,
    paymentTerms: input.paymentTerms,
    items,
    schedule: r ? { frequency: r.frequency, interval: r.interval, monthAnchor: r.monthAnchor, dayOfMonth: r.dayOfMonth ?? null, notifyMinutes: r.notifyMinutes, endDate: r.endDate?.toISOString() ?? null } : null,
    ...over,
  });
}

/** The fields the wizard edits (lines only matter in line-item mode; parts only for new part plans). */
const editable = (f: InvoiceFormState) => {
  const { lines, parts, ...rest } = f;
  void parts;
  return { ...rest, lines: f.useLines ? lines : [] };
};

describe("invoiceToForm", () => {
  it("maps a one-time single-amount draft and opens it as the wizard filled it", () => {
    const f = invoiceToForm(draft({ remindAt: remindAtIso("2026-11-01", "10:30"), notes: "Thanks" }), OPTS);
    expect(f).toMatchObject({ clientId: "c1", amount: "25000", description: "October retainer", useLines: false, gstPercent: "18", plan: "ONE_TIME", dueDate: "2026-11-15", remindDate: "2026-11-01", remindTime: "10:30", tdsApplicable: true, proforma: false, notes: "Thanks", partEdit: false });
    expect(validateForm(f)).toEqual({});
    expect(buildInvoiceInput(f)).toMatchObject({ clientId: "c1", amount: 25000, items: undefined, description: "October retainer", dueDate: "2026-11-15", remindAt: remindAtIso("2026-11-01", "10:30"), docType: null });
  });

  it("keeps line items (with HSN, hours) as lines", () => {
    const f = invoiceToForm(
      draft({ items: [{ description: "Reels", hsnSac: "998371", qty: 4, unit: "HOURS", rate: 1500, amount: 6000 }, { description: "Logo", hsnSac: null, qty: 1, unit: "FIXED", rate: 5000, amount: 5000 }] }),
      OPTS,
    );
    expect(f.useLines).toBe(true);
    expect(f.lines).toEqual([
      { description: "Reels", hsnSac: "998371", qty: "4", unit: "HOURS", rate: "1500" },
      { description: "Logo", hsnSac: "", qty: "1", unit: "FIXED", rate: "5000" },
    ]);
    expect(buildInvoiceInput(f).items).toEqual([
      { description: "Reels", hsnSac: "998371", qty: 4, unit: "HOURS", rate: 1500 },
      { description: "Logo", hsnSac: null, qty: 1, unit: "FIXED", rate: 5000 },
    ]);
  });

  it("a proforma / export draft (stored at 0%) offers the default GST again and keeps the proforma toggle", () => {
    const f = invoiceToForm(draft({ docType: "PROFORMA", taxMode: "NONE", gstPercent: 0 }), OPTS);
    expect(f).toMatchObject({ proforma: true, gstPercent: "18" });
    expect(invoiceToForm(draft({ gstPercent: 5 }), OPTS).gstPercent).toBe("5");
    expect(invoiceToForm(draft({ docType: "EXPORT_INVOICE", taxMode: "EXPORT_LUT", gstPercent: 0, currency: "AED" }), OPTS)).toMatchObject({ proforma: false, gstPercent: "18", currency: "AED" });
  });

  it("maps a recurring rule: frequency, day, notify time, end date, due days", () => {
    const f = invoiceToForm(
      draft({ plan: "RECURRING", dueDate: "2026-10-20T05:00:00.000Z", schedule: { frequency: "MONTHLY", interval: 1, monthAnchor: "DAY", dayOfMonth: 7, notifyMinutes: 615, endDate: "2027-03-31T00:00:00.000Z" } }),
      OPTS,
    );
    expect(f).toMatchObject({ plan: "RECURRING", frequency: "MONTHLY", monthAnchor: "DAY", dayOfMonth: "7", notifyTime: "10:15", infinite: false, endDate: "2027-03-31", dueDays: "10", dueDate: "2026-10-20", remindDate: "" });
    expect(buildInvoiceInput(f).recurrence).toEqual({ frequency: "MONTHLY", interval: 1, byWeekday: [], monthAnchor: "DAY", dayOfMonth: 7, notifyMinutes: 615, endDate: "2027-03-31" });
    const daily = invoiceToForm(draft({ plan: "RECURRING", schedule: { frequency: "DAILY", interval: 1, monthAnchor: "NONE", dayOfMonth: null, notifyMinutes: 540, endDate: null } }), OPTS);
    expect(daily).toMatchObject({ frequency: "CUSTOM", interval: "1", infinite: true });
  });

  it("a part-payment draft becomes one amount with partEdit; the input carries no schedule and passes the update schema", () => {
    const f = invoiceToForm(
      draft({ plan: "PART", description: "Website", items: [{ description: "Website — Part 1 of 2 (50%)", hsnSac: null, qty: 1, unit: "FIXED", rate: 10000, amount: 10000 }], planRef: { gstPercent: 18 } }),
      OPTS,
    );
    expect(f).toMatchObject({ plan: "PART", partEdit: true, useLines: false, amount: "10000", description: "Website", dueDate: "2026-11-15" });
    expect(validateForm(f)).toEqual({});
    const input = buildInvoiceInput(f);
    expect(input).toMatchObject({ plan: "PART", parts: null, amount: 10000, dueDate: "2026-11-15" });
    expect(invoiceUpdateSchema.safeParse(input).success).toBe(true);
    expect(invoiceInputSchema.safeParse(input).success).toBe(false); // create still needs a schedule
  });

  it("round-trips: form → input → stored draft → form", () => {
    const base = emptyForm({ gstPercent: 18, paymentTerms: "Net 15", today: TODAY });
    const cases: InvoiceFormState[] = [
      { ...base, clientId: "c1", amount: "12500.5", description: "Ads — October", dueDate: "2026-11-30", remindDate: "2026-11-02", remindTime: "08:45", tdsApplicable: true, notes: "PO 42" },
      { ...base, clientId: "c2", useLines: true, lines: [{ description: "Shoot", hsnSac: "998383", qty: "3", unit: "HOURS", rate: "2000" }, { description: "Edit", hsnSac: "", qty: "1", unit: "FIXED", rate: "4000" }], description: "Shoot day", proforma: true },
      { ...base, clientId: "c1", amount: "40000", description: "Retainer", plan: "RECURRING", frequency: "MONTHLY", monthAnchor: "END", notifyTime: "09:30", infinite: false, endDate: "2027-03-31", dueDays: "0", dueDate: "" },
      { ...base, clientId: "c1", amount: "900", description: "Hosting", plan: "RECURRING", frequency: "CUSTOM", interval: "14", notifyTime: "07:00", dueDate: "" },
    ];
    for (const f of cases) {
      const back = invoiceToForm(stored(f), OPTS);
      expect(editable(back)).toEqual(editable({ ...f, paymentTerms: f.paymentTerms, dueDays: f.plan === "RECURRING" ? back.dueDays : f.dueDays }));
      expect(buildInvoiceInput(back)).toEqual(buildInvoiceInput(f));
    }
  });
});

describe("edit helpers", () => {
  it("canEditDraft: only unnumbered drafts awaiting approval", () => {
    expect(canEditDraft(draft())).toBe(true);
    expect(canEditDraft(draft({ approvedAt: "2026-10-10T00:00:00.000Z" }))).toBe(false);
    expect(canEditDraft(draft({ number: "EOM/26-27/0001" }))).toBe(false);
    expect(canEditDraft(draft({ status: "SENT" }))).toBe(false);
    expect(canEditDraft(draft({ status: "CANCELLED" }))).toBe(false);
    expect(canEditDraft(draft({ docType: "CREDIT_NOTE" }))).toBe(false);
  });

  it("dateKeyOf reads day-only dates as entered and instants in the company zone", () => {
    expect(dateKeyOf("2026-11-15T00:00:00.000Z", TZ)).toBe("2026-11-15");
    expect(dateKeyOf("2026-11-15T20:00:00.000Z", TZ)).toBe("2026-11-16");
    expect(dateKeyOf(null, TZ)).toBe("");
  });

  it("minutesToHhmm / remindParts invert hhmmToMinutes / remindAtIso", () => {
    expect(minutesToHhmm(540)).toBe("09:00");
    expect(minutesToHhmm(1439)).toBe("23:59");
    expect(minutesToHhmm(null)).toBe("09:00");
    expect(remindParts(remindAtIso("2026-12-24", "18:05"))).toEqual({ remindDate: "2026-12-24", remindTime: "18:05" });
    expect(remindParts(null)).toEqual({ remindDate: "", remindTime: "09:00" });
  });
});
