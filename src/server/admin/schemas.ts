import { z } from "zod";

/** Zod schemas shared by the admin server actions (SPEC §11.7–§11.9). */

export const ROLES = ["ADMIN", "TEAM_LEADER", "EXECUTIVE", "HR", "CA"] as const;
export const roleSchema = z.enum(ROLES);

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

// ---------- People ----------
export const userInputSchema = z.object({
  email: z.email("Enter a valid email").transform((e) => e.trim().toLowerCase()),
  name: z.string().trim().min(1, "Name is required").max(120),
  role: roleSchema,
  teamId: optionalId,
  teamLeaderId: optionalId,
  dailyCapacityMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  workingDays: z.array(weekday).max(7).default([1, 2, 3, 4, 5, 6]),
});
export const updateUserSchema = userInputSchema.extend({ id });
export type UserInput = z.input<typeof userInputSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;

// ---------- Teams (Designations) ----------
export const teamInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  colour: colour.default("#2563eb"),
  leaderId: optionalId,
});
export const updateTeamSchema = teamInputSchema.extend({ id });
export type TeamInput = z.input<typeof teamInputSchema>;
export type UpdateTeamInput = z.input<typeof updateTeamSchema>;

// ---------- Clients ----------
export const clientInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  contact: optionalText(120),
  email: z
    .string()
    .trim()
    .optional()
    .nullable()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || z.email().safeParse(v).success, "Enter a valid email"),
  gstNumber: optionalText(30),
  address: optionalText(1000),
});
export const updateClientSchema = clientInputSchema.extend({ id });
export type ClientInput = z.input<typeof clientInputSchema>;
export type UpdateClientInput = z.input<typeof updateClientSchema>;

// ---------- Work types ----------
export const workTypeInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  colour: colour.default("#f59e0b"),
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

export const settingsInputSchema = z
  .object({
    companyName: z.string().trim().min(1, "Company name is required").max(120),
    address: z.string().trim().max(1000).default(""),
    gstNumber: z.string().trim().max(30).default(""),
    bankName: z.string().trim().max(120).default(""),
    bankAccountName: z.string().trim().max(120).default(""),
    bankAccountNumber: z.string().trim().max(40).default(""),
    bankIfsc: z.string().trim().max(20).default(""),
    upiId: z.string().trim().max(80).default(""),
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
  })
  .refine((s) => s.workStartMinutes < s.workEndMinutes, { message: "Work start must be before work end", path: ["workEndMinutes"] })
  .refine((s) => s.lunchStartMinutes <= s.lunchEndMinutes, { message: "Lunch start must be before lunch end", path: ["lunchEndMinutes"] })
  .refine((s) => s.lunchStartMinutes >= s.workStartMinutes && s.lunchEndMinutes <= s.workEndMinutes, {
    message: "Lunch must fall inside working hours",
    path: ["lunchStartMinutes"],
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
