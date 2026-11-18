"use server";
/**
 * Going home early (ADR 0022). Only Admin and HR mark, cancel and answer the morning question; only Admin shifts the
 * flagged tasks (HR sees them read-only: "Admin will shift these").
 */
import { z } from "zod";
import { wrap, type ActionResult } from "@/lib/action-result";
import { requireRole } from "@/lib/rbac";
import { safeRevalidate } from "@/lib/revalidate";
import { answerBack, cancelEarlyLeave, markEarlyLeave, previewFlagCount } from "@/server/early-leave/service";
import { planEarlyShift, shiftEarlyLeaveTasks, type EarlyShiftResult, type ShiftPlanItem } from "@/server/early-leave/shift";

const PATHS = ["/attendance", "/dashboard", "/admin/requests", "/admin/dashboards", "/admin/inventory"];

const markSchema = z
  .object({
    userId: z.string().min(1),
    leftAt: z.string().regex(/^\d{2}:\d{2}$/, "Set the time they left"),
    reason: z.enum(["SICK", "PERSONAL", "OTHER"]),
    mode: z.enum(["UNTIL", "ASK"]),
    until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  })
  .refine((v) => v.mode !== "UNTIL" || !!v.until, { message: "Pick the last day away", path: ["until"] });
export type EarlyLeaveInput = z.input<typeof markSchema>;

/** The sheet's live "N tasks of <Name> will be flagged for shifting". */
export async function previewEarlyLeave(input: EarlyLeaveInput): Promise<ActionResult<{ flagged: number }>> {
  return wrap(async () => {
    await requireRole("ADMIN", "HR");
    return { flagged: await previewFlagCount(markSchema.parse(input)) };
  });
}

/** "Mark & find tasks". */
export async function markGoingHomeEarly(input: EarlyLeaveInput): Promise<ActionResult<{ id: string; flagged: number }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN", "HR");
    const res = await markEarlyLeave(actor.id, markSchema.parse(input));
    safeRevalidate(...PATHS);
    return res;
  });
}

export async function cancelGoingHomeEarly(id: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN", "HR");
    await cancelEarlyLeave(actor.id, z.string().min(1).parse(id));
    safeRevalidate(...PATHS);
    return undefined;
  });
}

/** "Is <Name> back today?" → Back / Still off. */
export async function answerBackToday(id: string, back: boolean): Promise<ActionResult<{ flagged: number }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN", "HR");
    const res = await answerBack(actor.id, z.string().min(1).parse(id), back === true);
    safeRevalidate(...PATHS);
    return res;
  });
}

/** The confirm sheet: before → after per task (Admin only). */
export async function previewEarlyShift(id: string): Promise<ActionResult<ShiftPlanItem[]>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    return planEarlyShift(z.string().min(1).parse(id), actor.id);
  });
}

/** "Shift all to next free slots" (Admin only). */
export async function shiftAllEarlyLeave(id: string): Promise<ActionResult<EarlyShiftResult>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const res = await shiftEarlyLeaveTasks(z.string().min(1).parse(id), actor.id);
    safeRevalidate(...PATHS);
    return res;
  });
}
