"use server";
/**
 * "<Name> is off that day" (ADR 0019): a manual start on a leave / holiday / absent / non-working day is allowed — the
 * add-task and edit forms only warn (non-blocking), and Admin may still save it.
 */
import { z } from "zod";
import { wrap, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { toWorkingConfig } from "@/server/inventory/compute";
import { offDayWarningsFor, type OffDayWarning } from "@/server/availability/warnings";

const inputSchema = z.object({
  userIds: z.array(z.string().min(1)).max(50),
  /** A yyyy-MM-dd day (company zone) or an ISO instant. */
  start: z.string().min(10).max(40),
});

/** People among `userIds` who are off on the day `start` falls on (company time zone). */
export async function offDayWarnings(userIds: string[], start: string): Promise<ActionResult<OffDayWarning[]>> {
  return wrap(async () => {
    await requireUser();
    const input = inputSchema.parse({ userIds, start });
    const cfg = toWorkingConfig(await getSettings());
    const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(input.start);
    const instant = dayOnly ? null : new Date(input.start);
    if (instant && Number.isNaN(instant.getTime())) throw new Error("Invalid start");
    return offDayWarningsFor(input.userIds, instant ? dateKey(instant, cfg.timezone) : input.start, cfg);
  });
}
