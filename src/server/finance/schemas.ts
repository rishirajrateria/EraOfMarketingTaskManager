import { z } from "zod";

/** Shared zod schemas + a parse helper that throws readable messages (used by server actions). */
export function parseInput<T>(schema: z.ZodType<T>, data: unknown): T {
  const res = schema.safeParse(data);
  if (res.success) return res.data;
  throw new Error(res.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
}

const optionalStr = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Accepts ISO strings / yyyy-MM-dd / Date → Date (or null). */
export const dateInput = z
  .union([z.date(), z.string().trim().min(1)])
  .transform((v) => (v instanceof Date ? v : new Date(v)))
  .refine((d) => !Number.isNaN(d.getTime()), "invalid date");

export const optionalDateInput = z
  .union([dateInput, z.literal(""), z.null()])
  .optional()
  .transform((v) => (v instanceof Date ? v : null));

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, "description required").max(500),
  hsnSac: optionalStr,
  qty: z.coerce.number().min(0).default(1),
  unit: z.enum(["HOURS", "FIXED"]).default("FIXED"),
  rate: z.coerce.number().min(0),
});
export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

/** ADR 0007: monthly rules bill on the 1st (START), the last day (END) or `dayOfMonth` (DAY, 1–28), at `notifyMinutes` in the company tz. */
export const recurrenceInputSchema = z
  .object({
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]),
    interval: z.coerce.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.coerce.number().int().min(0).max(6)).default([]),
    monthAnchor: z.enum(["NONE", "START", "END", "DAY"]).default("NONE"),
    dayOfMonth: z.coerce.number().int().min(1, "day must be 1–28").max(28, "day must be 1–28").optional().nullable(),
    notifyMinutes: z.coerce.number().int().min(0).max(1439).default(540),
    endDate: optionalDateInput,
  })
  .superRefine((r, ctx) => {
    if (r.monthAnchor === "DAY" && r.dayOfMonth == null) ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "pick a day of the month (1–28)" });
  });
export type RecurrenceInput = z.infer<typeof recurrenceInputSchema>;

/** ISO 4217 code; blank → null (the client's currency applies). */
export const currencyInput = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[A-Z]{3}$/.test(v), "currency must be a 3-letter ISO code");

export const partInputSchema = z.object({
  kind: z.enum(["PERCENT", "FIXED"]).default("PERCENT"),
  value: z.coerce.number().positive("part value must be positive"),
  dueDate: dateInput,
  description: z.string().trim().max(500).default(""),
});
export type PartInput = z.infer<typeof partInputSchema>;

/** `createInvoice` input (ADR 0005). Either `items[]` or the `amount` + `description` convenience. */
export const invoiceInputSchema = z
  .object({
    clientId: z.string().min(1, "client required"),
    docType: z.enum(["TAX_INVOICE", "EXPORT_INVOICE", "PROFORMA"]).optional().nullable(),
    plan: z.enum(["ONE_TIME", "RECURRING", "PART"]).default("ONE_TIME"),
    items: z.array(invoiceItemSchema).optional(),
    amount: z.coerce.number().min(0).optional().nullable(),
    hsnSac: optionalStr,
    gstPercent: z.coerce.number().min(0).max(100).optional().nullable(),
    description: z.string().trim().max(5000).default(""),
    notes: optionalStr,
    paymentTerms: optionalStr,
    dueDate: optionalDateInput,
    recurrence: recurrenceInputSchema.optional().nullable(),
    parts: z.array(partInputSchema).optional().nullable(),
    /** ADR 0006: the client will deduct TDS on this invoice. Omitted/null → true when the client has a TDS %. */
    tdsApplicable: z.boolean().optional().nullable(),
    /** ADR 0007: printed currency (export invoices); null → the client's currency. */
    currency: currencyInput,
    /** ADR 0007: "remind me to approve and send on" (non-recurring documents). */
    remindAt: optionalDateInput,
  })
  .superRefine((v, ctx) => {
    const hasItems = (v.items?.length ?? 0) > 0;
    if (!hasItems && (v.amount == null || v.amount <= 0)) ctx.addIssue({ code: "custom", path: ["items"], message: "add at least one line item or an amount" });
    if (!hasItems && v.amount != null && v.amount > 0 && !v.description) ctx.addIssue({ code: "custom", path: ["description"], message: "description required with a single amount" });
    if (v.plan === "RECURRING" && !v.recurrence) ctx.addIssue({ code: "custom", path: ["recurrence"], message: "recurrence rule required for recurring invoices" });
    if (v.plan === "PART" && (v.parts?.length ?? 0) < 1) ctx.addIssue({ code: "custom", path: ["parts"], message: "at least one part required for part payments" });
  });
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

export const approveOptionsSchema = z.object({
  email: z.boolean().default(false),
  whatsapp: z.boolean().default(false),
  /** UI-only: the sheet opens the PDF download after approval; accepted so the form can pass it through. */
  download: z.boolean().optional().nullable(),
  emailText: optionalStr,
  whatsappText: optionalStr,
});
export type ApproveOptions = z.infer<typeof approveOptionsSchema>;

export const sendOptionsSchema = z.object({ email: z.boolean().default(false), whatsapp: z.boolean().default(false) });
export type SendOptions = z.infer<typeof sendOptionsSchema>;

export const mergePartsSchema = z.object({ dueDate: dateInput, description: optionalStr });
export const partScheduleSchema = z.array(partInputSchema).min(1, "at least one part");

export const creditNoteInputSchema = z.object({
  amount: z.coerce.number().positive().optional().nullable(),
  reason: z.string().trim().min(1, "reason required").max(1000),
});
export type CreditNoteInput = z.infer<typeof creditNoteInputSchema>;

export const paymentInputSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number().positive("amount must be positive"),
  receivedAt: optionalDateInput,
  method: z.enum(["CASH", "BANK", "UPI", "OTHER"]).default("BANK"),
  tdsAmount: z.coerce.number().min(0).optional().nullable(),
  tdsPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  reference: optionalStr,
  notes: optionalStr,
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

/** Checkbox / boolean input: "on", "true", "1", true → true; anything else → false. */
export const checkboxInput = z
  .union([z.boolean(), z.string(), z.null(), z.undefined()])
  .transform((v) => v === true || v === "on" || v === "true" || v === "1");

/** Optional number from a form field: "" / null / undefined → null. */
const optionalNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => (v === "" || v == null ? null : Number(v)))
  .refine((v) => v === null || Number.isFinite(v), "must be a number");

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Expense fields (SPEC §11.2 + ADR 0006). `amount` is the gross bill; when `tdsApplied` the TDS amount is
 * computed from the % unless given explicitly, and net paid = amount − tdsAmount.
 */
export const expenseFieldsSchema = z
  .object({
    date: dateInput,
    amount: z.coerce.number().min(0),
    category: z.string().trim().min(1, "category required").max(100), // must also match CompanySettings.expenseCategories — see expenses.ts
    vendor: optionalStr,
    note: optionalStr,
    tags: z
      .string()
      .optional()
      .nullable()
      .transform((s) =>
        (s ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    tdsApplied: checkboxInput,
    tdsPercent: optionalNumber.refine((v) => v === null || (v >= 0 && v <= 100), "tdsPercent must be between 0 and 100"),
    tdsAmount: optionalNumber.refine((v) => v === null || v >= 0, "tdsAmount must be positive"),
  })
  .transform((f) => {
    if (!f.tdsApplied) return { ...f, tdsPercent: null, tdsAmount: 0 };
    const tdsAmount = f.tdsAmount ?? (f.tdsPercent != null ? round2((f.amount * f.tdsPercent) / 100) : 0);
    return { ...f, tdsAmount: round2(tdsAmount) };
  })
  .refine((f) => f.tdsAmount <= f.amount + 0.005, { message: "TDS cannot exceed the bill amount", path: ["tdsAmount"] });
export type ExpenseFields = z.infer<typeof expenseFieldsSchema>;

export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be yyyy-MM");
