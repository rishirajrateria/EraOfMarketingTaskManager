import { z } from "zod";

export const recurrenceSchema = z
  .object({
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]),
    interval: z.number().int().min(1).max(365).default(1),
    byWeekday: z.array(z.number().int().min(0).max(6)).default([]),
    trigger: z.enum(["ON_COMPLETE", "ON_SCHEDULE"]).default("ON_SCHEDULE"),
    endDate: z.string().nullable().default(null), // yyyy-MM-dd or null = infinite
  })
  .nullable();

const ids = (max: number) => z.array(z.string()).max(max);
const isoOrNull = z.string().datetime({ offset: true }).nullable();

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
  scheduledStart: isoOrNull,
  scheduledEnd: isoOrNull,
  important: z.boolean(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
  recurrence: recurrenceSchema,
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
  scheduledStart: isoOrNull.default(null),
  scheduledEnd: isoOrNull.default(null),
  important: taskFields.important.default(false),
  priority: taskFields.priority.default("NORMAL"),
  recurrence: recurrenceSchema.default(null),
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
