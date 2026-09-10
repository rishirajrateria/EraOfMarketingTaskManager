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

export const taskInputSchema = z.object({
  type: z.enum(["WORK", "MEETING"]).default("WORK"),
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(20000).default(""),
  clientId: z.string().min(1, "Client is required"),
  assigneeIds: z.array(z.string()).min(1, "At least one assignee is required"),
  teamIds: z.array(z.string()).default([]),
  tagIds: z.array(z.string()).default([]),
  allocatedMinutes: z.number().int().min(5).max(24 * 60 * 30).default(60),
  scheduledStart: z.string().datetime({ offset: true }).nullable().default(null),
  scheduledEnd: z.string().datetime({ offset: true }).nullable().default(null),
  important: z.boolean().default(false),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  recurrence: recurrenceSchema.default(null),
  /** when the creator accepted the proposed slot, the client passes it back; otherwise server recomputes */
  acceptProposedSlot: z.boolean().default(true),
});

export type TaskInput = z.infer<typeof taskInputSchema>;

export const taskUpdateSchema = taskInputSchema.partial().extend({ id: z.string() });
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
