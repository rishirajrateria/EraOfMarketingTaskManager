"use server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { bus } from "@/lib/events";
import { safeRevalidate } from "@/lib/revalidate";
import { notify } from "@/lib/notify";

/** Generic resolve for request rows that have no dedicated action (Admin inbox). */
export async function resolveRequest(id: string, status: "RESOLVED" | "APPROVED" | "REJECTED", note = ""): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireRole("ADMIN", "HR");
    const r = await prisma.request.findUniqueOrThrow({ where: { id } });
    if (r.targetRole !== user.role && user.role !== "ADMIN") throw new Error("Not your inbox");
    await prisma.request.update({ where: { id }, data: { status, resolvedById: user.id, resolvedAt: new Date(), resolutionNote: note } });
    if (r.type === "DOUBT" && r.taskId) await prisma.task.update({ where: { id: r.taskId }, data: { doubtRaised: false, doubtNote: null } });
    if ((r.type === "REVIEW" || r.type === "TIME_CHANGE") && r.taskId) {
      const open = await prisma.request.count({ where: { taskId: r.taskId, type: { in: ["REVIEW", "TIME_CHANGE"] }, status: "OPEN" } });
      if (open === 0) await prisma.task.update({ where: { id: r.taskId }, data: { reviewRequested: false, reviewNote: null } });
    }
    await audit(user.id, "request.resolve", "Request", id, { status: r.status }, { status, note });
    await notify({ userIds: [r.raisedById], kind: "GENERIC", title: `Your ${r.type.toLowerCase().replace("_", " ")} request was ${status.toLowerCase()}`, body: note, href: r.taskId ? `/dashboard?task=${r.taskId}` : "/leave", taskId: r.taskId ?? undefined, chat: false });
    if (r.taskId) bus.publish({ type: "task.changed", taskId: r.taskId });
    bus.publish({ type: "requests.changed" });
    safeRevalidate("/requests", "/dashboard");
    return undefined;
  });
}
