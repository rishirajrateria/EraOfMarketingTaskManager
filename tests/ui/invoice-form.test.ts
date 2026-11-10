import { describe, expect, it } from "vitest";
import {
  buildInvoiceInput,
  contactWarnings,
  defaultPartsFor,
  emptyForm,
  formTax,
  formTotals,
  hhmmToMinutes,
  partsSummary,
  remindAtIso,
  renderTemplate,
  shiftDateKey,
  splitActionError,
  taxBadgeLabel,
  validateForm,
  type InvoiceFormState,
} from "@/components/finance/invoice-form-helpers";
import { invoiceInputSchema } from "@/server/finance/schemas";

const TODAY = "2026-10-09";
const base = (): InvoiceFormState => ({ ...emptyForm({ gstPercent: 18, paymentTerms: "Net 15", today: TODAY }), clientId: "c1", amount: "10000", description: "October retainer" });

const clients = [
  { id: "c1", name: "Glass Co", country: "IN", stateCode: "29", stateName: "Karnataka", gstNumber: "29ABCDE1234F1Z5" },
  { id: "c2", name: "Delhi Ltd", country: "IN", stateCode: "07", stateName: "Delhi", gstNumber: null },
  { id: "c3", name: "Acme US", country: "US", stateCode: null, stateName: null, gstNumber: null },
];

describe("defaultPartsFor", () => {
  it("splits 100% evenly and dates parts 30 days apart from today", () => {
    const parts = defaultPartsFor(3, TODAY);
    expect(parts.map((p) => p.value)).toEqual(["33.33", "33.33", "33.34"]);
    expect(parts.map((p) => p.dueDate)).toEqual(["2026-10-09", "2026-11-08", "2026-12-08"]);
    expect(parts.every((p) => p.kind === "PERCENT")).toBe(true);
  });
  it("never returns fewer than one part", () => {
    expect(defaultPartsFor(0, TODAY)).toHaveLength(1);
    expect(defaultPartsFor(1, TODAY)[0].value).toBe("100");
  });
  it("shiftDateKey crosses month and year boundaries", () => {
    expect(shiftDateKey("2026-12-25", 10)).toBe("2027-01-04");
  });
});

describe("partsSummary", () => {
  it("accepts percent + fixed rows that add up to the taxable total", () => {
    const s = partsSummary(
      [
        { kind: "PERCENT", value: "50", dueDate: TODAY, description: "" },
        { kind: "FIXED", value: "5000", dueDate: TODAY, description: "" },
      ],
      10000,
    );
    expect(s.valid).toBe(true);
    expect(s.allocated).toBe(10000);
    expect(s.remaining).toBe(0);
    expect(s.percent).toBe(100);
    expect(s.amounts).toEqual([5000, 5000]);
  });
  it("reports the unallocated remainder and over-allocation", () => {
    expect(partsSummary([{ kind: "PERCENT", value: "40", dueDate: TODAY, description: "" }], 10000)).toMatchObject({ valid: false, remaining: 6000, error: "₹6,000.00 still unallocated" });
    expect(partsSummary([{ kind: "FIXED", value: "12000", dueDate: TODAY, description: "" }], 10000)).toMatchObject({ valid: false, remaining: -2000, error: "Over-allocated by ₹2,000.00" });
  });
  it("requires dates and positive values", () => {
    expect(partsSummary([{ kind: "PERCENT", value: "100", dueDate: "", description: "" }], 100).error).toMatch(/due date/);
    expect(partsSummary([{ kind: "PERCENT", value: "0", dueDate: TODAY, description: "" }], 100).error).toMatch(/positive/);
    expect(partsSummary([], 100).error).toMatch(/at least one/);
  });
});

describe("tax + totals", () => {
  it("derives the document badge from the client and company state", () => {
    expect(taxBadgeLabel(formTax({ clientId: "c1", proforma: false }, clients, "29")!)).toBe("Tax Invoice · CGST+SGST");
    expect(taxBadgeLabel(formTax({ clientId: "c2", proforma: false }, clients, "29")!)).toBe("Tax Invoice · IGST");
    expect(taxBadgeLabel(formTax({ clientId: "c3", proforma: false }, clients, "29")!)).toBe("Export Invoice · 0% under LUT");
    expect(taxBadgeLabel(formTax({ clientId: "c1", proforma: true }, clients, "29")!)).toBe("Proforma · No tax");
    expect(formTax({ clientId: "", proforma: false }, clients, "29")).toBeNull();
  });
  it("splits GST for the live totals card and zero-rates exports", () => {
    const f = base();
    expect(formTotals(f, "CGST_SGST")).toMatchObject({ taxable: 10000, cgst: 900, sgst: 900, igst: 0, total: 11800 });
    expect(formTotals(f, "IGST")).toMatchObject({ igst: 1800, total: 11800 });
    expect(formTotals(f, "EXPORT_LUT")).toMatchObject({ gstPercent: 0, gstAmount: 0, total: 10000 });
  });
  it("sums line items when the multi-line editor is on", () => {
    const f: InvoiceFormState = {
      ...base(),
      useLines: true,
      lines: [
        { description: "Design", hsnSac: "", qty: "2", unit: "HOURS", rate: "1500" },
        { description: "Hosting", hsnSac: "9983", qty: "1", unit: "FIXED", rate: "700" },
      ],
    };
    expect(formTotals(f, "CGST_SGST").taxable).toBe(3700);
  });
});

describe("buildInvoiceInput", () => {
  it("produces a valid one-time input from a single amount", () => {
    const input = buildInvoiceInput({ ...base(), dueDate: "2026-10-24" });
    const parsed = invoiceInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    expect(input).toMatchObject({ clientId: "c1", plan: "ONE_TIME", amount: 10000, description: "October retainer", gstPercent: 18, docType: null, recurrence: null, parts: null, paymentTerms: "Net 15" });
    expect(input.items).toBeUndefined();
  });
  it("sends line items, proforma doc type and drops blank lines", () => {
    const input = buildInvoiceInput({
      ...base(),
      proforma: true,
      useLines: true,
      lines: [
        { description: "Design", hsnSac: " 9983 ", qty: "2", unit: "HOURS", rate: "1500" },
        { description: "", hsnSac: "", qty: "1", unit: "FIXED", rate: "" },
      ],
    });
    expect(input.docType).toBe("PROFORMA");
    expect(input.amount).toBeNull();
    expect(input.items).toEqual([{ description: "Design", hsnSac: "9983", qty: 2, unit: "HOURS", rate: 1500 }]);
    expect(invoiceInputSchema.safeParse(input).success).toBe(true);
  });
  it("builds a monthly recurrence billed on the last day with no end date", () => {
    const input = buildInvoiceInput({ ...base(), plan: "RECURRING", frequency: "MONTHLY", monthAnchor: "END", infinite: true, dueDate: "2026-10-24" });
    expect(input.recurrence).toEqual({ frequency: "MONTHLY", interval: 1, byWeekday: [], monthAnchor: "END", dayOfMonth: null, notifyMinutes: 540, endDate: null });
    expect(input.remindAt).toBeNull();
    expect(invoiceInputSchema.safeParse(input).success).toBe(true);
  });
  it("builds a monthly recurrence on a chosen day at a chosen time (ADR 0007)", () => {
    const input = buildInvoiceInput({ ...base(), plan: "RECURRING", frequency: "MONTHLY", monthAnchor: "DAY", dayOfMonth: "15", notifyTime: "10:30", infinite: true, dueDate: "2026-10-24", remindDate: "2026-10-20" });
    expect(input.recurrence).toMatchObject({ monthAnchor: "DAY", dayOfMonth: 15, notifyMinutes: 630 });
    expect(input.remindAt).toBeNull(); // recurring: no one-off reminder
    expect(invoiceInputSchema.safeParse(input).success).toBe(true);
    expect(validateForm({ ...base(), plan: "RECURRING", frequency: "MONTHLY", monthAnchor: "DAY", dayOfMonth: "31" }).recurrence).toMatch(/1 and 28/);
    expect(hhmmToMinutes("09:00")).toBe(540);
    expect(hhmmToMinutes("23:59")).toBe(1439);
  });
  it("non-recurring documents carry 'remind me to approve and send on' (date + time) and the currency", () => {
    const input = buildInvoiceInput({ ...base(), remindDate: "2026-10-20", remindTime: "14:30", currency: "aed" });
    expect(input.remindAt).toBe(new Date("2026-10-20T14:30:00").toISOString());
    expect(input.currency).toBe("AED");
    const parsed = invoiceInputSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.remindAt).toEqual(new Date("2026-10-20T14:30:00"));
      expect(parsed.data.currency).toBe("AED");
    }
    expect(buildInvoiceInput({ ...base(), remindDate: "" }).remindAt).toBeNull();
    expect(remindAtIso("2026-10-20", "bad")).toBe(new Date("2026-10-20T09:00:00").toISOString());
    expect(validateForm({ ...base(), remindDate: "20-10-2026" }).remindAt).toBeTruthy();
  });
  it("builds a custom-days recurrence with an end date", () => {
    const input = buildInvoiceInput({ ...base(), plan: "RECURRING", frequency: "CUSTOM", interval: "10", infinite: false, endDate: "2027-03-31" });
    expect(input.recurrence).toMatchObject({ frequency: "CUSTOM", interval: 10, monthAnchor: "NONE", endDate: "2027-03-31" });
  });
  it("builds a part plan whose first part sets the due date", () => {
    const f: InvoiceFormState = { ...base(), plan: "PART", parts: defaultPartsFor(2, TODAY) };
    const input = buildInvoiceInput(f);
    expect(input.parts).toEqual([
      { kind: "PERCENT", value: 50, dueDate: "2026-10-09", description: "" },
      { kind: "PERCENT", value: 50, dueDate: "2026-11-08", description: "" },
    ]);
    expect(input.dueDate).toBe("2026-10-09");
    expect(invoiceInputSchema.safeParse(input).success).toBe(true);
  });
});

describe("validateForm", () => {
  it("flags the missing pieces per field", () => {
    const f = { ...base(), clientId: "", amount: "", description: "" };
    expect(validateForm(f)).toEqual({ clientId: "Pick a client", amount: "Enter an amount", description: "Describe what this invoice is for" });
  });
  it("requires parts to add up", () => {
    const f: InvoiceFormState = { ...base(), plan: "PART", parts: [{ kind: "PERCENT", value: "40", dueDate: TODAY, description: "" }] };
    expect(validateForm(f).parts).toMatch(/unallocated/);
  });
  it("accepts a complete form", () => {
    expect(validateForm(base())).toEqual({});
  });
});

describe("renderTemplate", () => {
  it("fills known placeholders and keeps unknown ones for the server", () => {
    expect(renderTemplate("Hi {{client}}, {{ number }} for INR {{total}} → {{link}}", { client: "Glass Co", total: "11,800.00" })).toBe("Hi Glass Co, {{ number }} for INR 11,800.00 → {{link}}");
  });
});

describe("splitActionError", () => {
  it("maps the zod-style message into field errors", () => {
    expect(splitActionError("parts: at least one part required; description: required; Something else")).toEqual({ fields: { parts: "at least one part required", description: "required" }, rest: "Something else" });
  });
});

describe("contactWarnings", () => {
  it("lists the missing channels", () => {
    expect(contactWarnings({ email: null, whatsapp: "+919999999999" })).toEqual(["No email on file"]);
    expect(contactWarnings({ email: "a@b.c", whatsapp: null })).toEqual(["No WhatsApp number"]);
    expect(contactWarnings({ email: "a@b.c", whatsapp: "+91" })).toEqual([]);
  });
});

describe("partsSummary with a percent base", () => {
  it("treats percent parts as a share of the plan total while validating against the remaining amount", () => {
    const s = partsSummary(
      [
        { kind: "PERCENT", value: "25", dueDate: TODAY, description: "" },
        { kind: "FIXED", value: "2500", dueDate: TODAY, description: "" },
      ],
      5000,
      10000,
    );
    expect(s.amounts).toEqual([2500, 2500]);
    expect(s.valid).toBe(true);
  });
});
