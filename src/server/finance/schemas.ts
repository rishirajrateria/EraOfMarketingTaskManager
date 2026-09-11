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

export const invoiceInputSchema = z.object({
  clientId: z.string().min(1, "client required"),
  items: z.array(invoiceItemSchema).min(1, "at least one line item"),
  gstPercent: z.coerce.number().min(0).max(100).optional(),
  notes: optionalStr,
  paymentTerms: optionalStr,
  dueDate: optionalDateInput,
  kind: z.enum(["ONE_TIME", "RECURRING"]).default("ONE_TIME"),
  recurrence: z
    .object({
      frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]),
      interval: z.coerce.number().int().min(1).max(365).default(1),
      byWeekday: z.array(z.coerce.number().int().min(0).max(6)).default([]),
      endDate: optionalDateInput,
    })
    .optional()
    .nullable(),
  paymentMode: z.enum(["FULL", "ADVANCE"]).default("FULL"),
  advancePercent: z.coerce.number().int().min(1).max(99).optional().nullable(),
  /** ADVANCE only — how the balance invoice is raised: on `balanceDueOn`, by hand, or automatically (as a draft) once the client's tasks are complete. */
  balanceMode: z.enum(["DATE", "MANUAL", "AUTO"]).optional().nullable(),
  balanceDueOn: optionalDateInput,
  sendAt: optionalDateInput,
});
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

export const paymentInputSchema = z.object({
  invoiceId: z.string().min(1),
  amount: z.coerce.number().positive("amount must be positive"),
  receivedAt: optionalDateInput,
  method: z.string().trim().min(1).max(60).default("BANK_TRANSFER"),
  reference: optionalStr,
});
export type PaymentInput = z.infer<typeof paymentInputSchema>;

export const expenseFieldsSchema = z.object({
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
});
export type ExpenseFields = z.infer<typeof expenseFieldsSchema>;

export const monthKeySchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be yyyy-MM");
