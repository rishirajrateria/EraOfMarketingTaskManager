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

/** ADR 0009: cancel a sent invoice (reason printed on the stamped copy). */
export const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(1, "Write a short reason").max(500),
  email: z.boolean().default(false),
  whatsapp: z.boolean().default(false),
});

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

// ---------- Payables (ADR 0009) ----------

const dateKeyStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be yyyy-MM-dd");

/**
 * Repeat rule shared by recurring bills (and, later, the task repeat picker). Weekdays are 0 = Sun … 6 = Sat;
 * monthDay 32 = last day of the month; nth 1–5 (5 = last); yearMonth 1–12. `anchorDate` is the first due date.
 */
export const repeatRuleSchema = z
  .object({
    freq: z.enum(["DAILY", "WEEKDAYS", "WEEKLY", "MONTHLY", "YEARLY"]),
    interval: z.coerce.number().int().min(1).max(365).default(1),
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).default([]),
    monthMode: z.enum(["DATE", "NTH"]).default("DATE"),
    monthDay: z.coerce.number().int().min(1).max(32).default(1),
    nth: z.coerce.number().int().min(1).max(5).default(1),
    nthWeekday: z.coerce.number().int().min(0).max(6).default(1),
    yearMonth: z.coerce.number().int().min(1).max(12).default(1),
    yearDay: z.coerce.number().int().min(1).max(31).default(1),
    endsType: z.enum(["NEVER", "COUNT", "UNTIL"]).default("NEVER"),
    endsCount: z.coerce.number().int().min(1).max(1000).optional().nullable(),
    endsUntil: dateKeyStr.optional().nullable(),
    anchorDate: dateKeyStr.optional().nullable(),
  })
  .superRefine((r, ctx) => {
    if (r.freq === "WEEKLY" && r.weekdays.length === 0) ctx.addIssue({ code: "custom", path: ["weekdays"], message: "pick at least one weekday" });
    if (r.endsType === "COUNT" && !r.endsCount) ctx.addIssue({ code: "custom", path: ["endsCount"], message: "how many times?" });
    if (r.endsType === "UNTIL" && !r.endsUntil) ctx.addIssue({ code: "custom", path: ["endsUntil"], message: "pick the end date" });
  });
export type RepeatRule = z.output<typeof repeatRuleSchema>;
export type RepeatRuleInput = z.input<typeof repeatRuleSchema>;

export const EXPENSE_METHODS = ["CASH", "UPI", "BANK", "CARD", "CHEQUE"] as const;
export type ExpenseMethodKey = (typeof EXPENSE_METHODS)[number];

const money = z.coerce.number().finite();

/** createBill / updateBill input. Amount: ONE_TIME the bill, RECURRING each payment, PART the total of all parts. */
export const billInputSchema = z
  .object({
    payee: z.string().trim().max(200).default(""),
    kind: z.enum(["REGULAR", "SALARY"]).default("REGULAR"),
    salaryUserId: z.string().trim().optional().nullable(),
    timing: z.enum(["PREPAID", "POSTPAID", "ADVANCE"]).default("PREPAID"),
    category: z.string().trim().min(1, "category required").max(100),
    note: optionalStr,
    plan: z.enum(["ONE_TIME", "RECURRING", "PART"]).default("ONE_TIME"),
    amount: money.refine((n) => n > 0, "Enter the amount"),
    remindDays: z.coerce.number().int().min(0).max(60).default(1),
    vendorGstin: optionalStr,
    /** ONE_TIME due date / RECURRING first due date (yyyy-MM-dd, company timezone). */
    dueDate: dateKeyStr.optional().nullable(),
    alreadyPaid: z.boolean().default(false),
    paidMethod: z.enum(EXPENSE_METHODS).default("UPI"),
    rule: repeatRuleSchema.optional().nullable(),
    partMode: z.enum(["FIXED", "PERCENT"]).default("FIXED"),
    parts: z
      .array(z.object({ value: money.refine((n) => n > 0, "Fill every part's amount and date"), dueDate: dateKeyStr, note: z.string().trim().max(200).default("") }))
      .default([]),
  })
  .superRefine((b, ctx) => {
    if (b.kind === "SALARY" && !b.salaryUserId) ctx.addIssue({ code: "custom", path: ["salaryUserId"], message: "Pick the team member" });
    if (b.kind === "REGULAR" && !b.payee) ctx.addIssue({ code: "custom", path: ["payee"], message: "Who are you paying?" });
    if (b.plan !== "PART" && !b.dueDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Pick the due date" });
    if (b.plan === "RECURRING" && !b.rule) ctx.addIssue({ code: "custom", path: ["rule"], message: "Choose how often it repeats" });
    if (b.plan === "PART") {
      if (b.parts.length < 1) ctx.addIssue({ code: "custom", path: ["parts"], message: "Add at least one part" });
      const sum = b.parts.reduce((s, p) => s + p.value, 0);
      if (b.partMode === "PERCENT" && Math.abs(sum - 100) > 0.01) ctx.addIssue({ code: "custom", path: ["parts"], message: "Parts must add up to 100%" });
      if (b.partMode === "FIXED" && Math.abs(sum - b.amount) > 0.5) ctx.addIssue({ code: "custom", path: ["parts"], message: `Parts must add up to ₹${b.amount.toLocaleString("en-IN")}` });
    }
  });
export type BillInput = z.output<typeof billInputSchema>;
export type BillInputRaw = z.input<typeof billInputSchema>;

/** "Bill & GST" block: GST included in the amount, rate, amount (auto = amount × rate / (100 + rate)), GSTIN, ITC. */
export const gstFieldsSchema = z.object({
  includesGst: z.boolean().default(false),
  gstRate: z.coerce.number().min(0).max(100).optional().nullable(),
  gstAmount: z.coerce.number().min(0).optional().nullable(),
  vendorGstin: optionalStr,
  itcClaimable: z.boolean().default(false),
});
export type GstFields = z.output<typeof gstFieldsSchema>;
export type GstFieldsRaw = z.input<typeof gstFieldsSchema>;

export const markPaidSchema = z.object({
  amount: money.refine((n) => n > 0, "Enter the amount"),
  paidOn: dateKeyStr,
  method: z.enum(EXPENSE_METHODS),
  reference: optionalStr,
  tdsPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  tdsAmount: z.coerce.number().min(0).optional().nullable(),
  gst: gstFieldsSchema.optional().nullable(),
});
export type MarkPaidInput = z.output<typeof markPaidSchema>;
export type MarkPaidRaw = z.input<typeof markPaidSchema>;

export const dateKeySchema = dateKeyStr;
export const financeEmailSchema = z.string().trim().refine((v) => z.email().safeParse(v).success, "Enter a valid email");

export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be yyyy-MM");
