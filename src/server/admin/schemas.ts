import { z } from "zod";
import { stateByCode, stateFromGstin } from "@/server/finance/tax";
import { normalizeE164 } from "@/integrations/whatsapp";

/** Zod schemas shared by the admin server actions (SPEC §11.7–§11.9). */

export const ROLES = ["ADMIN", "TEAM_LEADER", "EXECUTIVE", "HR", "CA"] as const;
export const roleSchema = z.enum(ROLES);
/** Roles Admin may assign. CA access is parked (ADR 0004): the enum value stays, but no user can be given it. */
export const ASSIGNABLE_ROLES = ["ADMIN", "TEAM_LEADER", "EXECUTIVE", "HR"] as const;
export const assignableRoleSchema = roleSchema.refine((r) => r !== "CA", "CA access is not available");

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be in #rrggbb form");
const weekday = z.number().int().min(0).max(6);
const id = z.string().min(1);
const optionalId = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));
const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-MM-dd");
const minutesOfDay = z.number().int().min(0).max(1440);

/** Fixed expense category list (ADR 0004): trimmed, non-empty, de-duplicated case-insensitively, order preserved. */
export const expenseCategoryListSchema = z
  .array(z.string().trim().min(1, "Category name is required").max(60))
  .min(1, "Add at least one expense category")
  .max(50)
  .transform((list) => {
    const seen = new Set<string>();
    return list.filter((c) => {
      const key = c.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

// ---------- People ----------
export const userInputSchema = z.object({
  email: z.email("Enter a valid email").transform((e) => e.trim().toLowerCase()),
  name: z.string().trim().min(1, "Name is required").max(120),
  role: assignableRoleSchema,
  teamId: optionalId,
  teamLeaderId: optionalId,
  dailyCapacityMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  workingDays: z.array(weekday).max(7).default([1, 2, 3, 4, 5, 6]),
  /** Work types this person is best at — must be work types of their team (ADR 0008). */
  specialityIds: z.array(id).max(50).default([]),
});
export const updateUserSchema = userInputSchema.extend({ id });
export type UserInput = z.input<typeof userInputSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;

// ---------- Teams ----------
export const teamInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  colour: colour.default("#2563eb"),
  leaderId: optionalId,
});
export const updateTeamSchema = teamInputSchema.extend({ id });
export type TeamInput = z.input<typeof teamInputSchema>;
export type UpdateTeamInput = z.input<typeof updateTeamSchema>;

// ---------- Clients ----------
/** PAN card: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F). Stored uppercase; optional. */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const clientInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  /** Legal / business name printed on invoices; `name` stays the display name. */
  businessName: optionalText(200),
  contact: optionalText(120),
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email"),
  gstNumber: optionalText(30).transform((v) => (v ? v.replace(/\s+/g, "").toUpperCase() : null)),
  pan: optionalText(20)
    .transform((v) => (v ? v.replace(/\s+/g, "").toUpperCase() : null))
    .refine((v) => v === null || PAN_REGEX.test(v), "PAN must be 5 letters, 4 digits and a letter (e.g. ABCDE1234F)"),
  address: optionalText(1000),
  /** ISO-3166 alpha-2; anything but IN is billed as an export (ADR 0005). */
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Country must be a 2-letter ISO code")
    .default("IN"),
  stateCode: optionalText(2).refine((v) => v === null || stateByCode(v) !== null, "Unknown GST state code"),
  stateName: optionalText(80),
  phone: optionalText(30),
  whatsapp: optionalText(30).refine((v) => v === null || normalizeE164(v) !== null, "WhatsApp number must be in E.164 form, e.g. +919876543210"),
  tdsPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  /** ADR 0007: ISO 4217 the client is billed in (export invoices); Indian clients are always INR. */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .nullable()
    .transform((v) => v || "INR")
    .refine((v) => /^[A-Z]{3}$/.test(v), "Currency must be a 3-letter ISO code"),
});
export const updateClientSchema = clientInputSchema.extend({ id });
export type ClientInput = z.input<typeof clientInputSchema>;
export type UpdateClientInput = z.input<typeof updateClientSchema>;

/** State is derived from the GSTIN when present (editable otherwise); WhatsApp is normalised to E.164. */
export function withDerivedClientFields<T extends z.output<typeof clientInputSchema>>(input: T): T {
  const fromGstin = stateFromGstin(input.gstNumber);
  const state = fromGstin ?? stateByCode(input.stateCode);
  const india = (input.country || "IN") === "IN";
  return {
    ...input,
    stateCode: india ? (state?.code ?? null) : null,
    stateName: india ? (state ? state.name : input.stateName) : null,
    whatsapp: normalizeE164(input.whatsapp),
    tdsPercent: input.tdsPercent ?? null,
    currency: india ? "INR" : input.currency || "INR",
  };
}

// ---------- Work types ----------
export const workTypeInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  colour: colour.default("#f59e0b"),
  /** Teams that do this work (ADR 0008) — at least one. */
  teamIds: z
    .array(id)
    .max(50)
    .transform((ids) => Array.from(new Set(ids)))
    .pipe(z.array(id).min(1, "Pick at least one team")),
});
export const updateWorkTypeSchema = workTypeInputSchema.extend({ id });
export type WorkTypeInput = z.input<typeof workTypeInputSchema>;
export type UpdateWorkTypeInput = z.input<typeof updateWorkTypeSchema>;

// ---------- Company settings ----------
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const shortText = (max: number) => z.string().trim().max(max).default("");

export const settingsInputSchema = z
  .object({
    companyName: z.string().trim().min(1, "Company name is required").max(120),
    /** ADR 0007: company block printed on every invoice. */
    legalName: shortText(160),
    address: z.string().trim().max(1000).default(""),
    gstNumber: shortText(30).transform((v) => v.replace(/\s+/g, "").toUpperCase()),
    stateCode: shortText(2).refine((v) => v === "" || stateByCode(v) !== null, "Unknown GST state code"),
    pan: shortText(20)
      .transform((v) => v.replace(/\s+/g, "").toUpperCase())
      .refine((v) => v === "" || PAN_REGEX.test(v), "PAN must be 5 letters, 4 digits and a letter (e.g. ABCDE1234F)"),
    lutNumber: shortText(40),
    iecCode: shortText(40),
    email: shortText(160).refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid billing email"),
    phone: shortText(30),
    website: shortText(160),
    hsnSacCode: shortText(20),
    bankName: shortText(120),
    bankAccountName: shortText(120),
    bankAccountNumber: shortText(40),
    bankIfsc: shortText(20),
    bankSwift: shortText(20),
    bankAddress: shortText(300),
    upiId: shortText(80),
    workStartMinutes: minutesOfDay,
    workEndMinutes: minutesOfDay,
    lunchStartMinutes: minutesOfDay,
    lunchEndMinutes: minutesOfDay,
    workingDays: z.array(weekday).min(1, "Pick at least one working day").max(7),
    holidays: z.array(dateKey).max(366),
    timezone: z.string().trim().min(1).refine(isValidTimezone, "Unknown IANA timezone"),
    invoicePrefix: z.string().trim().max(20).default(""),
    invoiceNextNumber: z.number().int().min(1),
    receiptPrefix: z.string().trim().max(20).default(""),
    receiptNextNumber: z.number().int().min(1),
    invoiceTerms: z.string().trim().max(2000).default(""),
    invoiceEmailTemplate: z.string().max(5000).default(""),
    defaultGstPercent: z.number().min(0).max(100),
    notifyEmailDefault: z.boolean(),
    notifyChatDefault: z.boolean(),
    restartCreatesNewWorkspace: z.boolean(),
    recurrenceCreatesNewWorkspace: z.boolean(),
    halfDayMinutes: minutesOfDay,
    expenseCategories: expenseCategoryListSchema,
    /** ADR 0006: TDS applies once payments to one payee reach this amount within a financial year. */
    tdsThresholdAmount: z.number().min(0).max(1_000_000_000).default(20000),
    /** ADR 0009: the finance person who receives the monthly GST pack. */
    financeEmail: shortText(160).refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid finance email"),
  })
  .refine((s) => s.workStartMinutes < s.workEndMinutes, { message: "Work start must be before work end", path: ["workEndMinutes"] })
  .refine((s) => s.lunchStartMinutes <= s.lunchEndMinutes, { message: "Lunch start must be before lunch end", path: ["lunchEndMinutes"] })
  .refine((s) => s.lunchStartMinutes >= s.workStartMinutes && s.lunchEndMinutes <= s.workEndMinutes, {
    message: "Lunch must fall inside working hours",
    path: ["lunchStartMinutes"],
  })
  .refine((s) => s.halfDayMinutes <= s.workEndMinutes - s.workStartMinutes, {
    message: "Half day cannot be longer than the working day",
    path: ["halfDayMinutes"],
  });
export type SettingsInput = z.input<typeof settingsInputSchema>;

/** Parses with `schema`, throwing a readable Error (surfaced to the client via `wrap()`). */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const msg = result.error.issues
    .slice(0, 3)
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
  throw new Error(msg);
}
