"use server";
/**
 * Admin "Pause all" / "Resume all" (ADR 0015): applies to the open tasks the dashboard currently shows. One transaction
 * for every task, the same writes as pausing / resuming one task (`pause-core.ts`), one audit entry per task, and the
 * assignees are notified with the optional reason. Tasks that can't take the transition are skipped and counted.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, can, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { notify, taskStakeholderIds, publishTaskChanged } from "@/lib/notify";
import { safeRevalidate } from "@/lib/revalidate";
import { scopeWhere } from "@/server/tasks/queries";
import { canTransition } from "@/server/tasks/state";
import { pauseOps, resumeOps } from "@/server/tasks/pause-core";
import { queueTaskPropagation } from "@/google/task-integrations";

const inputSchema = z.object({
  taskIds: z.array(z.string().min(1).max(64)).min(1, "No tasks to change").max(500),
  action: z.enum(["PAUSE", "RESUME"]),
  reason: z.string().max(500).default(""),
});

export async function pauseResumeMany(raw: { taskIds: string[]; action: "PAUSE" | "RESUME"; reason?: string }): Promise<ActionResult<{ changed: number; skipped: number }>> {
  return wrap(async () => {
    const { taskIds, action, reason: rawReason } = inputSchema.parse(raw);
    const user = await requireUser();
    if (!can.pauseResume(user)) throw new ForbiddenError("Only Admin can pause or resume tasks");
    const ids = Array.from(new Set(taskIds));
    const tasks = await prisma.task.findMany({
      where: { id: { in: ids }, deletedAt: null, ...scopeWhere(user) },
      select: { id: true, title: true, status: true, statusBeforePause: true, pausedAt: true, scheduledEnd: true },
    });
    if (tasks.length !== ids.length) throw new Error("Some of these tasks no longer exist or aren't visible — refresh and try again");
    const transition = action === "PAUSE" ? "PAUSE" : "RESUME";
    const eligible = tasks.filter((t) => canTransition(t.status, transition));
    if (!eligible.length) return { changed: 0, skipped: tasks.length };
    const now = new Date();
    const plans = eligible.map((t) => ({ t, plan: action === "PAUSE" ? pauseOps(t, now) : resumeOps(t, now) }));
    await prisma.$transaction(plans.flatMap((p) => p.plan.ops));

    const reason = rawReason.trim();
    for (const { t, plan } of plans) {
      await audit(user.id, action === "PAUSE" ? "task.pause_all" : "task.resume_all", "Task", t.id, { status: t.status }, { status: plan.status, reason });
      if (action === "RESUME") await queueTaskPropagation(t.id); // the scheduled end moved
      await notify({
        userIds: await taskStakeholderIds(t.id, { includeAdmins: false }),
        kind: action === "PAUSE" ? "TASK_PAUSED" : "TASK_RESUMED",
        title: `${action === "PAUSE" ? "Paused" : "Resumed"}: ${t.title}`,
        body: reason || undefined,
        href: `/dashboard?task=${t.id}`,
        taskId: t.id,
      });
      void publishTaskChanged(t.id);
    }
    safeRevalidate("/dashboard");
    if (action === "RESUME") void import("@/google/queue").then((q) => q.processPending()).catch(() => undefined);
    return { changed: plans.length, skipped: tasks.length - plans.length };
  });
}
