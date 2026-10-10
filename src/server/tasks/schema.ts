import { z } from "zod";

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-MM-dd date");

/**
 * "Repeat this task" (ADR 0010, prototype `recurPicker`). Fields a frequency doesn't use may be left out; the server
 * fills them from the first occurrence's day (`completeRule`).
 */
export const recurrenceSchema = z
  .object({
    freq: z.enum(["DAILY", "WEEKDAYS", "WEEKLY", "MONTHLY", "YEARLY"]),
    interval: z.number().int().min(1).max(365).default(1),
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    monthMode: z.enum(["DATE", "NTH"]).default("DATE"),
    monthDay: z.number().int().min(1).max(32).optional(), // 32 = last day of the month
    nth: z.number().int().min(1).max(5).optional(), // 5 = last
    nthDay: z.number().int().min(0).max(6).optional(),
    yMonth: z.number().int().min(0).max(11).optional(),
    yDay: z.number().int().min(1).max(31).optional(),
    ends: z.enum(["NEVER", "COUNT", "UNTIL"]).default("NEVER"),
    count: z.number().int().min(1).max(999).default(10),
    until: z.union([dayKey, z.literal("")]).default(""),
    anchor: dayKey.optional(),
    trigger: z.enum(["ON_COMPLETE", "ON_SCHEDULE"]).default("ON_SCHEDULE"),
  })
  .superRefine((r, ctx) => {
    if (r.ends === "UNTIL" && !r.until) ctx.addIssue({ code: "custom", path: ["until"], message: "Pick the last date for the repeat" });
  })
  .nullable();
export type RecurrenceInput = NonNullable<z.infer<typeof recurrenceSchema>>;

/** Google Calendar allows at most 5 reminder overrides per event; a reminder may be up to 4 weeks before. */
export const MAX_REMINDERS = 5;
export const MAX_REMINDER_MINUTES = 4 * 7 * 24 * 60;
export const GOOGLE_COLOR_IDS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"] as const;

const isTimeZone = (tz: string) => {
  if (!tz) return true; // "" = the company time zone
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
/** An IANA zone ("" = the company time zone): a meeting's zone, also the zone a date-only start is read in. */
export const timeZoneInput = z.string().max(64).refine(isTimeZone, "Unknown time zone");

/** Meeting → Google Calendar event options (ADR 0012). Every field has a default so older / partial payloads parse. */
export const meetingOptionsSchema = z.object({
  reminders: z
    .array(z.object({ method: z.enum(["popup", "email"]), minutes: z.number().int().min(0).max(MAX_REMINDER_MINUTES) }))
    .max(MAX_REMINDERS, `Google Calendar allows at most ${MAX_REMINDERS} notifications`)
    .default([{ method: "popup", minutes: 10 }]),
  guestsCanModify: z.boolean().default(false),
  guestsCanInviteOthers: z.boolean().default(true),
  guestsCanSeeOtherGuests: z.boolean().default(true),
  location: z.string().trim().max(500).default(""),
  transparency: z.enum(["opaque", "transparent"]).default("opaque"),
  visibility: z.enum(["default", "public", "private"]).default("default"),
  /** "" = the calendar's colour; "1"–"11" = Google's event colours. */
  colorId: z.enum(["", ...GOOGLE_COLOR_IDS]).default(""),
  allDay: z.boolean().default(false),
  /** IANA zone the start time is interpreted in; "" = company settings time zone. */
  timeZone: timeZoneInput.default(""),
  withMeet: z.boolean().default(true),
});
export type MeetingOptions = z.infer<typeof meetingOptionsSchema>;

/** External guest emails: trimmed, lowercased, deduped; an invalid address is rejected with its value. */
export const guestEmailsSchema = z
  .array(z.string().trim().toLowerCase())
  .max(100, "At most 100 guests")
  .superRefine((list, ctx) => {
    const bad = list.find((e) => !z.email().safeParse(e).success);
    if (bad !== undefined) ctx.addIssue({ code: "custom", message: `Invalid guest email: ${bad || "(empty)"}` });
  })
  .transform((list) => Array.from(new Set(list)));

const ids = (max: number) => z.array(z.string()).max(max);
const isoOrNull = z.string().datetime({ offset: true }).nullable();

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** A date-only start before today (in the zone the day is read in) is refused — by the sheet and by the server alike. */
export const PAST_DAY_MESSAGE = "That day has passed — pick today or later";
/** "2026-10-23": a date with no time — the start is "the next free time on that day" (ADR 0010 addendum). */
export const isDateOnly = (s: string | null | undefined): s is string => !!s && DATE_ONLY_RE.test(s) && isRealDay(s);
/** A yyyy-MM-dd that exists on the calendar (rejects 2026-02-30 and month 13). */
function isRealDay(s: string): boolean {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
/**
 * `scheduledStart` input: an ISO instant ("2026-10-23T14:00:00+05:30" — explicit), a date only ("2026-10-23" — the next
 * free time on that day, resolved by the server before saving) or null (the next free slot from now).
 */
const startInput = z.union([z.string().datetime({ offset: true }), z.string().regex(DATE_ONLY_RE).refine(isRealDay, "Unknown date")]).nullable();

/** Field rules shared by create and update (no defaults here: zod 4 applies defaults even under `.partial()`). */
const taskFields = {
  type: z.enum(["WORK", "MEETING"]),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(20000),
  clientId: z.string().min(1, "Client is required"),
  /** Admin: the chosen teams' Team Leaders are assigned for work; everyone else: at least one (ADR 0008). */
  assigneeIds: ids(50),
  teamIds: ids(20),
  /** Work type(s) — the add-task WORK row picks exactly one; required for WORK tasks. */
  tagIds: ids(20),
  allocatedMinutes: z.number().int().min(5).max(24 * 60 * 30),
  scheduledStart: startInput,
  scheduledEnd: isoOrNull,
  important: z.boolean(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  recurrence: recurrenceSchema,
  /** Meetings: external guests (client email + typed). Ignored for work tasks. */
  guestEmails: guestEmailsSchema,
  /** Meetings: Google Calendar options. Ignored for work tasks. */
  meetingOptions: meetingOptionsSchema.nullable(),
};

export const taskInputSchema = z.object({
  ...taskFields,
  type: taskFields.type.default("WORK"),
  description: taskFields.description.default(""),
  assigneeIds: taskFields.assigneeIds.default([]),
  teamIds: taskFields.teamIds.default([]),
  tagIds: taskFields.tagIds.default([]),
  /** Admin's suggested executives (must be executives of the chosen teams); the Team Leader decides. */
  preferredAssigneeIds: ids(50).default([]),
  allocatedMinutes: taskFields.allocatedMinutes.default(60),
  scheduledStart: startInput.default(null),
  scheduledEnd: isoOrNull.default(null),
  important: taskFields.important.default(false),
  priority: taskFields.priority.default("NORMAL"),
  recurrence: recurrenceSchema.default(null),
  guestEmails: guestEmailsSchema.default([]),
  meetingOptions: meetingOptionsSchema.nullable().default(null),
  /**
   * Meetings: invite the client's own addresses, resolved on the server — Team Leaders and Executives never receive
   * them (ADR 0017 privacy), so their form sends this instead of the emails.
   */
  inviteClient: z.boolean().default(false),
  /** when the creator accepted the proposed slot, the client passes it back; otherwise server recomputes */
  acceptProposedSlot: z.boolean().default(true),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

/** Admin edit: only the fields that are sent change (preferences are kept, ADR 0008). */
export const taskUpdateSchema = z.object(taskFields).partial().extend({ id: z.string(), assigneeIds: ids(50).min(1, "At least one assignee is required").optional() });
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;

/** Long-press → Assign executive (Team Leader / Admin). */
export const assignExecutivesSchema = z.object({
  taskId: z.string().min(1),
  userIds: z.array(z.string().min(1)).min(1, "Pick at least one person").max(50),
});
