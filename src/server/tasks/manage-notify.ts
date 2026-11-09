import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";
import { taskDeepLink } from "@/lib/notification-kinds";
import { whenPhrase } from "@/lib/notification-text";

/** Open review / time-change requests on a task, read before an Admin edit resolves them. */
export async function openEditableRequests(taskId: string) {
  return prisma.request.findMany({ where: { taskId, type: { in: ["REVIEW", "TIME_CHANGE"] }, status: "OPEN" }, select: { raisedById: true, type: true } });
}

/** "Your time-change request was handled — task edited" to each requester (once per person and kind), never the editor. */
export async function tellEditHandled(taskId: string, handled: { raisedById: string; type: string }[], editorId: string) {
  const seen = new Set<string>();
  for (const r of handled) {
    const key = `${r.raisedById}:${r.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const what = r.type === "TIME_CHANGE" ? "time-change" : "review";
    await notify({ userIds: [r.raisedById], exceptUserId: editorId, kind: "GENERIC", title: `Your ${what} request was handled — task edited`, href: taskDeepLink(taskId), taskId, chat: false });
  }
}

const sameTime = (a: Date | null | undefined, b: Date | null | undefined) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Did the edit move the task's start or end? (An unset field means "unchanged".) */
export function timesMoved(before: { scheduledStart: Date | null; scheduledEnd: Date | null }, after: { start: Date | null | undefined; end: Date | null | undefined }): boolean {
  const startMoved = after.start !== undefined && !sameTime(before.scheduledStart, after.start);
  const endMoved = after.end !== undefined && !sameTime(before.scheduledEnd, after.end);
  return startMoved || endMoved;
}

/** TASK_SHIFTED to the assignees and their Team Leaders (ADR 0017), minus the editor and anyone just assigned. */
export async function tellTimeShifted(taskId: string, assigneeIds: string[], editorId: string, when: Date, tz: string, skip: string[] = []) {
  const leaders = await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { teamLeaderId: true } });
  const ids = [...assigneeIds, ...leaders.map((l) => l.teamLeaderId).filter((x): x is string => !!x)].filter((id) => !skip.includes(id));
  await notify({ userIds: ids, exceptUserId: editorId, kind: "TASK_SHIFTED", title: `Moved to ${whenPhrase(when, new Date(), tz)}`, href: taskDeepLink(taskId), taskId });
}
