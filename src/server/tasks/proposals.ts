"use server";
/**
 * Proposal decisions (ADR 0021): Admin approves (optionally after editing), or rejects with a note; the proposing Team
 * Leader may withdraw while it waits. Rejected / withdrawn proposals are soft-deleted (kept for audit).
 */
import { z } from "zod";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { requireRole, requireUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { adminIds, notify, publishTaskChanged } from "@/lib/notify";
import { bus } from "@/lib/events";
import { safeRevalidate } from "@/lib/revalidate";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { proposalApprovedPhrase, proposalRejectedPhrase, proposalWithdrawnPhrase, whenPhrase } from "@/lib/notification-text";
import { taskDeepLink } from "@/lib/notification-kinds";
import { sanitizeDescription } from "@/lib/sanitize";
import { queueTaskCreation } from "@/google/task-integrations";
import { shiftDisplacedTasks } from "@/server/scheduling/slot";
import { recurrenceSchema } from "@/server/tasks/schema";
import { completeRule } from "@/server/tasks/repeat-rule";
import { nextRunAt, repeatRuleData } from "@/server/tasks/recurrence";
import { teamLeaderIds, workTypeIdsForTeams, MSG } from "@/server/tasks/assignment";
import { MSG_PROPOSAL, PENDING, placeApproved } from "@/server/tasks/proposal-core";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a yyyy-MM-dd date");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use an HH:mm time");

/** "Edit & approve": what Admin may change before approving (the TL's preferred slot included). */
const approveEditsSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    description: z.string().max(20000),
    clientId: z.string().min(1),
    tagIds: z.array(z.string().min(1)).min(1, MSG.pickWork).max(20),
    allocatedMinutes: z.number().int().min(5).max(24 * 60 * 30),
    priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    requestedDate: day.nullable(),
    requestedTime: time.nullable(),
  })
  .partial();
export type ApproveEdits = z.infer<typeof approveEditsSchema>;

async function loadPending(taskId: string) {
  const t = await prisma.task.findUnique({ where: { id: z.string().min(1).parse(taskId) }, include: { teams: true } });
  if (!t || t.deletedAt) throw new Error("Task not found");
  if (t.status !== PENDING) throw new Error(MSG_PROPOSAL.notPending);
  return t;
}

function changed(taskId: string) {
  void publishTaskChanged(taskId);
  bus.publish({ type: "requests.changed" });
  safeRevalidate("/dashboard", "/admin/requests");
}

/** The Team Leader the approved task goes to: the proposer while active, else the team's current leader. */
async function approvedAssignee(t: { proposedById: string | null; createdById: string; teams: { teamId: string }[] }) {
  const id = t.proposedById ?? t.createdById;
  if (await prisma.user.count({ where: { id, active: true } })) return id;
  const leaders = await teamLeaderIds(t.teams.map((x) => x.teamId));
  if (!leaders.length) throw new Error(MSG.noLeader);
  return leaders[0]!;
}

async function ruleFor(raw: unknown, start: Date, tz: string) {
  const parsed = recurrenceSchema.safeParse(raw);
  if (!parsed.success || !parsed.data) return null;
  const { trigger, ...r } = parsed.data;
  const anchor = dateKey(start, tz);
  const data = repeatRuleData(completeRule({ ...r, anchor }, anchor), tz);
  return prisma.recurrenceRule.create({ data: { ...data, trigger, nextRunAt: nextRunAt(data, start, tz, 1) } });
}

/**
 * Approve / Edit & approve: the proposal becomes an ordinary ASSIGNED task for its Team Leader — at the requested time
 * when that is still free, else at the next free slot — then the Google items are queued and the TL is told.
 */
export async function approveProposal(taskId: string, rawEdits: unknown = {}): Promise<ActionResult<{ taskId: string; start: string; onRequested: boolean }>> {
  return wrap(async () => {
    const user = await requireRole("ADMIN");
    const edits = approveEditsSchema.parse(rawEdits ?? {});
    const t = await loadPending(taskId);
    if (edits.tagIds) {
      const allowed = new Set(await workTypeIdsForTeams(t.teams.map((x) => x.teamId)));
      if (!edits.tagIds.every((id) => allowed.has(id))) throw new Error(MSG.pickWork);
    }
    if (edits.clientId && !(await prisma.client.count({ where: { id: edits.clientId, active: true } }))) throw new Error("Pick a client");
    const assigneeId = await approvedAssignee(t);
    const minutes = t.deadlineOnly ? 0 : (edits.allocatedMinutes ?? t.allocatedMinutes);
    const req = {
      requestedDate: edits.requestedDate !== undefined ? edits.requestedDate : t.requestedDate,
      requestedTime: edits.requestedTime !== undefined ? edits.requestedTime : t.requestedTime,
    };
    const place = await placeApproved({ id: t.id, allocatedMinutes: minutes, deadlineOnly: t.deadlineOnly }, req, assigneeId, user);
    const tz = (await getSettings()).timezone;
    const rule = await ruleFor(t.requestedRecurrence, place.start, tz);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: t.id },
        data: {
          title: edits.title,
          description: edits.description === undefined ? undefined : sanitizeDescription(edits.description),
          clientId: edits.clientId,
          priority: edits.priority,
          allocatedMinutes: minutes,
          ...req,
          status: "ASSIGNED",
          assignedById: user.id,
          scheduledStart: place.start,
          scheduledEnd: place.end,
          decidedById: user.id,
          decidedAt: now,
          recurrenceRuleId: rule?.id,
          assignees: { deleteMany: {}, create: [{ userId: assigneeId }] },
          ...(edits.tagIds ? { tags: { deleteMany: {}, create: edits.tagIds.map((workTypeId) => ({ workTypeId })) } } : {}),
        },
      });
      await tx.request.updateMany({ where: { taskId: t.id, type: "TASK_PROPOSAL", status: "OPEN" }, data: { status: "APPROVED", resolvedById: user.id, resolvedAt: now } });
      if (edits.clientId) await tx.client.update({ where: { id: edits.clientId }, data: { visibleInFilters: true } });
    });
    await audit(user.id, "task.approve_proposal", "Task", t.id, { status: PENDING }, { status: "ASSIGNED", assigneeId, start: place.start, edits });
    await queueTaskCreation(t.id, "WORK");
    if (place.slot?.displaced.length) await shiftDisplacedTasks(place.slot.displaced, user.id);
    const when = t.deadlineOnly ? `due ${formatInTimeZone(place.start, tz, "d MMM")}` : whenPhrase(place.start, now, tz);
    await notify({ userIds: [assigneeId], exceptUserId: user.id, kind: "TASK_PROPOSAL_APPROVED", title: proposalApprovedPhrase(when), href: taskDeepLink(t.id), taskId: t.id, chat: false });
    changed(t.id);
    void import("@/google/queue").then((q) => q.processPending()).catch(() => undefined);
    return { taskId: t.id, start: place.start.toISOString(), onRequested: place.onRequested };
  });
}

/** Reject with a required note: the TL is told, the proposal leaves their list and is kept (soft-deleted) for audit. */
export async function rejectProposal(taskId: string, rawNote: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireRole("ADMIN");
    const note = z.string().trim().min(1, "A note is required").max(2000).parse(rawNote ?? "");
    const t = await loadPending(taskId);
    const now = new Date();
    await prisma.$transaction([
      prisma.task.update({ where: { id: t.id }, data: { decidedById: user.id, decidedAt: now, decisionNote: note, deletedAt: now, deletedById: user.id } }),
      prisma.request.updateMany({ where: { taskId: t.id, type: "TASK_PROPOSAL", status: "OPEN" }, data: { status: "REJECTED", resolvedById: user.id, resolvedAt: now, resolutionNote: note } }),
    ]);
    await audit(user.id, "task.reject_proposal", "Task", t.id, { status: PENDING }, { rejected: true, note });
    const tl = t.proposedById ?? t.createdById;
    await notify({ userIds: [tl], exceptUserId: user.id, kind: "TASK_PROPOSAL_REJECTED", title: proposalRejectedPhrase(note), href: "/dashboard", taskId: t.id, chat: false });
    bus.publish({ type: "task.deleted", taskId: t.id });
    changed(t.id);
    return undefined;
  });
}

/** The proposing Team Leader takes it back while it waits. Nothing was booked; the row is kept for audit. */
export async function withdrawProposal(taskId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    const t = await loadPending(taskId);
    if ((t.proposedById ?? t.createdById) !== user.id) throw new ForbiddenError("Only the Team Leader who proposed it can withdraw it");
    const now = new Date();
    await prisma.$transaction([
      prisma.task.update({ where: { id: t.id }, data: { deletedAt: now, deletedById: user.id, decisionNote: "Withdrawn" } }),
      prisma.request.updateMany({ where: { taskId: t.id, type: "TASK_PROPOSAL", status: "OPEN" }, data: { status: "RESOLVED", resolvedById: user.id, resolvedAt: now, resolutionNote: "Withdrawn" } }),
    ]);
    await audit(user.id, "task.withdraw_proposal", "Task", t.id, { status: PENDING }, { withdrawn: true });
    await notify({ userIds: await adminIds(), exceptUserId: user.id, kind: "GENERIC", title: proposalWithdrawnPhrase(user.name), href: "/admin/requests?tab=WORK", taskId: t.id, chat: false });
    bus.publish({ type: "task.deleted", taskId: t.id });
    changed(t.id);
    return undefined;
  });
}
