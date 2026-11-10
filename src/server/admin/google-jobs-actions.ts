"use server";
import { z } from "zod";
import { requireRole } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { dismissFailedJob, retryFailedJob } from "@/google/queue";
import { parseInput } from "@/server/finance/schemas";

/** Failed Google jobs (ADR 0020): Admin only. Retry reuses the existing retry; Dismiss hides the row. Both audit-logged. */
const jobId = z.string().trim().min(1).max(64);

export async function retryGoogleJob(raw: unknown): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const me = await requireRole("ADMIN");
    const id = parseInput(jobId, raw);
    await retryFailedJob(id);
    await audit(me.id, "integration.job.retry", "IntegrationJob", id, undefined, undefined);
    void import("@/google/queue").then((q) => q.processPending()).catch(() => undefined);
    safeRevalidate("/admin/settings", "/dashboard");
    return undefined;
  });
}

export async function dismissGoogleJob(raw: unknown): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const me = await requireRole("ADMIN");
    const id = parseInput(jobId, raw);
    await dismissFailedJob(id);
    await audit(me.id, "integration.job.dismiss", "IntegrationJob", id, undefined, undefined);
    safeRevalidate("/admin/settings", "/dashboard");
    return undefined;
  });
}
