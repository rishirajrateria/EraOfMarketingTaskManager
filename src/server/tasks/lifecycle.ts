"use server";
import { prisma } from "@/lib/db";
import { requireUser, can, ForbiddenError, type SessionUser } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { notify, taskStakeholderIds, adminIds, publishTaskChanged } from "@/lib/notify";
import { bus } from "@/lib/events";
import { safeRevalidate } from "@/lib/revalidate";
import { canView } from "@/server/tasks/queries";
import { nextStatus } from "@/server/tasks/state";
import { queueTaskCreation, queueTaskPropagation } from "@/google/task-integrations";
import { circleTapAction } from "@/server/tasks/circle";
import { pauseOps, resumeOps } from "@/server/tasks/pause-core";
import { fieldForKind, reviewFieldsOf, withField } from "@/server/tasks/review-fields";
import { proposeSlot } from "@/server/scheduling/slot";
import { getSettings } from "@/lib/settings";
import { z } from "zod";

const noteSchema = z.string().max(2000);
const reviewKindSchema = z.enum(["REVIEW", "TIME_CHANGE"]);

async function loadTask(user: SessionUser, taskId: string) {
  if (!(await canView(user, taskId))) throw new ForbiddenError("Task not visible");
  const t = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true, recurrenceRule: true } });
  if (!t || t.deletedAt) throw new Error("Task not found");
  return t;
}

function done(taskId: string) {
  void publishTaskChanged(taskId);
  safeRevalidate("/dashboard", "/requests");
}

/** Long-press → Start (Admin / Team Leader). */
export async function startTask(taskId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!can.startTask(user)) throw new ForbiddenError();
    const t = await loadTask(user, taskId);
    const status = nextStatus(t.status, "START");
    const now = new Date();
    await prisma.$transaction([
      prisma.task.update({ where: { id: t.id }, data: { status, actualStart: t.actualStart ?? now, overdue: false } }),
      prisma.taskSession.create({ data: { taskId: t.id, startedAt: now } }),
    ]);
    await audit(user.id, "task.start", "Task", t.id, { status: t.status }, { status });
    await notify({ userIds: (await taskStakeholderIds(t.id)).filter((id) => id !== user.id), kind: "TASK_STARTED", title: `Started: ${t.title}`, href: `/dashboard?task=${t.id}`, taskId: t.id });
    done(t.id);
    return undefined;
  });
}

/** Admin only. Freezes the clock; scheduled end shifts by the paused duration on resume. */
export async function pauseTask(taskId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!can.pauseResume(user)) throw new ForbiddenError();
    const t = await loadTask(user, taskId);
    const { status, ops } = pauseOps(t, new Date());
    await prisma.$transaction(ops);
    await audit(user.id, "task.pause", "Task", t.id, { status: t.status }, { status });
    await notify({ userIds: (await taskStakeholderIds(t.id, { includeAdmins: false })), kind: "TASK_PAUSED", title: `Paused: ${t.title}`, href: `/dashboard?task=${t.id}`, taskId: t.id });
    done(t.id);
    return undefined;
  });
}

export async function resumeTask(taskId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!can.pauseResume(user)) throw new ForbiddenError();
    const t = await loadTask(user, taskId);
    const { status, pausedMin, ops } = resumeOps(t, new Date());
    await prisma.$transaction(ops);
    await audit(user.id, "task.resume", "Task", t.id, { status: t.status }, { status, pausedMin });
    await queueTaskPropagation(t.id);
    await notify({ userIds: (await taskStakeholderIds(t.id, { includeAdmins: false })), kind: "TASK_RESUMED", title: `Resumed: ${t.title}`, href: `/dashboard?task=${t.id}`, taskId: t.id });
    done(t.id);
    return undefined;
  });
}

/** Team Leader / Executive: done from my side → FINISH_REQUESTED + Request row for Admin (SPEC §7, ADR 0015). */
async function doRequestFinish(user: SessionUser, taskId: string) {
  if (!can.requestFinish(user)) throw new ForbiddenError();
  const t = await loadTask(user, taskId);
  if (user.role === "EXECUTIVE" && !t.assignees.some((a) => a.userId === user.id)) throw new ForbiddenError("Only the assigned people can mark this done");
  const status = nextStatus(t.status, "REQUEST_FINISH");
  const now = new Date();
  await prisma.$transaction([
    prisma.task.update({ where: { id: t.id }, data: { status, finishRequestedAt: now, finishRequestedById: user.id, overdue: false } }),
    prisma.request.create({ data: { type: "FINISH", taskId: t.id, raisedById: user.id, targetRole: "ADMIN", note: "" } }),
  ]);
  await audit(user.id, "task.request_finish", "Task", t.id, { status: t.status }, { status });
  await notify({ userIds: await adminIds(), kind: "FINISH_REQUESTED", title: `Finish requested: ${t.title}`, body: `by ${user.name ?? ""}`, href: `/requests`, taskId: t.id });
  bus.publish({ type: "requests.changed" });
  done(t.id);
}

export async function requestFinish(taskId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    await doRequestFinish(await requireUser(), taskId);
    return undefined;
  });
}

/** Admin: approve (or complete directly — from ASSIGNED / STARTED too). Meet, Drive and Chat stay until delete (ADR 0015). */
async function doApproveFinish(user: SessionUser, taskId: string) {
  if (!can.approveFinish(user)) throw new ForbiddenError();
  const t = await loadTask(user, taskId);
  const status = nextStatus(t.status, "APPROVE_FINISH");
  const now = new Date();
  await prisma.$transaction([
    prisma.taskSession.updateMany({ where: { taskId: t.id, endedAt: null }, data: { endedAt: now } }),
    prisma.task.update({ where: { id: t.id }, data: { status, actualEnd: now, approvedAt: now, approvedById: user.id, overdue: false, doubtRaised: false } }),
    prisma.request.updateMany({ where: { taskId: t.id, type: "FINISH", status: "OPEN" }, data: { status: "APPROVED", resolvedById: user.id, resolvedAt: now } }),
  ]);
  await audit(user.id, "task.approve_finish", "Task", t.id, { status: t.status }, { status });
  await notify({ userIds: (await taskStakeholderIds(t.id, { includeAdmins: false })), kind: "FINISH_APPROVED", title: `Completed: ${t.title}`, href: `/dashboard?task=${t.id}&completed=1`, taskId: t.id });
  if (t.recurrenceRule && t.recurrenceRule.trigger === "ON_COMPLETE" && !t.recurrenceRule.stopped) {
    const { spawnNextOccurrence } = await import("@/server/tasks/recurring");
    await spawnNextOccurrence(t.id, user.id);
  }
  bus.publish({ type: "requests.changed" });
  done(t.id);
}

export async function approveFinish(taskId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    await doApproveFinish(await requireUser(), taskId);
    return undefined;
  });
}

/**
 * The card's completion circle (ADR 0015, like Google Tasks): Admin completes the task, a Team Leader / Executive
 * marks their side done (finish request). The dashboard sends this only after the Undo window has passed.
 */
export async function completeFromMySide(taskId: string): Promise<ActionResult<{ kind: "complete" | "request_finish" }>> {
  return wrap(async () => {
    const user = await requireUser();
    const t = await loadTask(user, taskId);
    const action = circleTapAction(user.role, { status: t.status, assigneeIds: t.assignees.map((a) => a.userId) }, user.id);
    if (action.kind === "none") throw new Error(action.message);
    if (action.kind === "complete") await doApproveFinish(user, taskId);
    else await doRequestFinish(user, taskId);
    return { kind: action.kind };
  });
}

export async function rejectFinish(taskId: string, rawNote: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const note = noteSchema.parse(rawNote);
    const user = await requireUser();
    if (!can.approveFinish(user)) throw new ForbiddenError();
    const t = await loadTask(user, taskId);
    const status = nextStatus(t.status, "REJECT_FINISH");
    const now = new Date();
    await prisma.$transaction([
      prisma.task.update({ where: { id: t.id }, data: { status, finishRequestedAt: null, rejectionNote: note } }),
      prisma.request.updateMany({ where: { taskId: t.id, type: "FINISH", status: "OPEN" }, data: { status: "REJECTED", resolvedById: user.id, resolvedAt: now, resolutionNote: note } }),
    ]);
    await audit(user.id, "task.reject_finish", "Task", t.id, { status: t.status }, { status, note });
    await notify({ userIds: (await taskStakeholderIds(t.id, { includeAdmins: false })), kind: "FINISH_REJECTED", title: `Finish rejected: ${t.title}`, body: note, href: `/dashboard?task=${t.id}`, taskId: t.id });
    bus.publish({ type: "requests.changed" });
    done(t.id);
    return undefined;
  });
}

/** Team Leader → Raise doubt (yellow). */
export async function raiseDoubt(taskId: string, rawNote: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const note = noteSchema.parse(rawNote);
    const user = await requireUser();
    if (!can.raiseDoubt(user)) throw new ForbiddenError();
    const t = await loadTask(user, taskId);
    await prisma.$transaction([
      prisma.task.update({ where: { id: t.id }, data: { doubtRaised: true, doubtNote: note } }),
      prisma.request.create({ data: { type: "DOUBT", taskId: t.id, raisedById: user.id, targetRole: "ADMIN", note } }),
    ]);
    await audit(user.id, "task.raise_doubt", "Task", t.id, null, { note });
    await notify({ userIds: await adminIds(), kind: "DOUBT_RAISED", title: `Doubt: ${t.title}`, body: note, href: `/requests`, taskId: t.id });
    bus.publish({ type: "requests.changed" });
    done(t.id);
    return undefined;
  });
}

/** Admin → Unflag. */
export async function resolveDoubt(taskId: string, rawNote = ""): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const note = noteSchema.parse(rawNote);
    const user = await requireUser();
    if (!can.resolveDoubt(user)) throw new ForbiddenError();
    const t = await loadTask(user, taskId);
    const now = new Date();
    await prisma.$transaction([
      prisma.task.update({ where: { id: t.id }, data: { doubtRaised: false, doubtNote: null } }),
      prisma.request.updateMany({ where: { taskId: t.id, type: "DOUBT", status: "OPEN" }, data: { status: "RESOLVED", resolvedById: user.id, resolvedAt: now, resolutionNote: note } }),
    ]);
    await audit(user.id, "task.resolve_doubt", "Task", t.id, { doubtNote: t.doubtNote }, { note });
    await notify({ userIds: (await taskStakeholderIds(t.id, { includeAdmins: false })), kind: "DOUBT_RESOLVED", title: `Doubt resolved: ${t.title}`, body: note, href: `/dashboard?task=${t.id}`, taskId: t.id });
    bus.publish({ type: "requests.changed" });
    done(t.id);
    return undefined;
  });
}

/** Long-press → review / time-change request (red dot). Executives only on own tasks. */
export async function raiseReviewRequest(taskId: string, rawKind: "REVIEW" | "TIME_CHANGE", rawNote: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const kind = reviewKindSchema.parse(rawKind);
    const note = noteSchema.parse(rawNote);
    const user = await requireUser();
    if (!can.raiseReview(user)) throw new ForbiddenError();
    const t = await loadTask(user, taskId);
    if (user.role === "EXECUTIVE" && !t.assignees.some((a) => a.userId === user.id)) throw new ForbiddenError("Own tasks only");
    const field = fieldForKind(kind); // the pill it concerns (ADR 0015)
    await prisma.$transaction([
      prisma.task.update({ where: { id: t.id }, data: { reviewRequested: true, reviewNote: note, reviewFields: withField(reviewFieldsOf(t), field, true) } }),
      prisma.request.create({ data: { type: kind, field, taskId: t.id, raisedById: user.id, targetRole: "ADMIN", note } }),
    ]);
    await audit(user.id, "task.raise_review", "Task", t.id, null, { kind, note });
    await notify({ userIds: await adminIds(), kind: "REVIEW_REQUESTED", title: `${kind === "REVIEW" ? "Review" : "Time change"} requested: ${t.title}`, body: note, href: `/requests`, taskId: t.id });
    bus.publish({ type: "requests.changed" });
    done(t.id);
    return undefined;
  });
}

/** TL/Exec: ask Admin to protect (fix) a self-assigned task so it cannot be overlapped/moved. */
export async function requestFixSelfTask(taskId: string, rawNote: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const note = noteSchema.parse(rawNote);
    const user = await requireUser();
    if (user.role !== "TEAM_LEADER" && user.role !== "EXECUTIVE") throw new ForbiddenError();
    const t = await loadTask(user, taskId);
    if (!t.selfAssigned || !t.assignees.some((a) => a.userId === user.id)) throw new ForbiddenError("Only your own self-assigned tasks");
    await prisma.request.create({ data: { type: "FIX_SELF_TASK", taskId: t.id, raisedById: user.id, targetRole: "ADMIN", note } });
    await audit(user.id, "task.request_fix", "Task", t.id, null, { note });
    await notify({ userIds: await adminIds(), kind: "REVIEW_REQUESTED", title: `Fix request: ${t.title}`, body: note, href: `/requests`, taskId: t.id, chat: false });
    bus.publish({ type: "requests.changed" });
    done(t.id);
    return undefined;
  });
}

/** Restart: duplicate a completed task into ASSIGNED with fresh times/workspace (SPEC §7). */
export async function restartTask(taskId: string): Promise<ActionResult<{ taskId: string }>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!can.restartTask(user)) throw new ForbiddenError();
    const t = await prisma.task.findUnique({ where: { id: taskId }, include: { assignees: true, teams: true, tags: true } });
    if (!t || t.deletedAt) throw new Error("Task not found");
    if (!(await canView(user, taskId))) throw new ForbiddenError();
    nextStatus(t.status, "RESTART");
    const settings = await getSettings();
    const ids = t.assignees.map((a) => a.userId);
    const slot = await proposeSlot(ids, t.allocatedMinutes, { requesterRole: user.role, requesterId: user.id });
    const reuse = !settings.restartCreatesNewWorkspace;
    const dup = await prisma.task.create({
      data: {
        title: t.title,
        description: t.description,
        type: t.type,
        clientId: t.clientId,
        createdById: user.id,
        assignedById: user.id,
        allocatedMinutes: t.allocatedMinutes,
        scheduledStart: slot?.start ?? null,
        scheduledEnd: slot?.end ?? null,
        important: t.important,
        priority: t.priority,
        selfAssigned: t.selfAssigned,
        protected: t.protected,
        parentTaskId: t.id,
        status: "ASSIGNED",
        driveFolderId: reuse ? t.driveFolderId : null,
        driveFolderUrl: reuse ? t.driveFolderUrl : null,
        chatSpaceId: reuse ? t.chatSpaceId : null,
        chatSpaceUrl: reuse ? t.chatSpaceUrl : null,
        assignees: { create: ids.map((userId) => ({ userId })) },
        teams: { create: t.teams.map((x) => ({ teamId: x.teamId })) },
        tags: { create: t.tags.map((x) => ({ workTypeId: x.workTypeId })) },
      },
    });
    await audit(user.id, "task.restart", "Task", dup.id, { parentTaskId: t.id }, dup);
    await queueTaskCreation(dup.id, t.type);
    await notify({ userIds: ids.filter((id) => id !== user.id), kind: "TASK_ASSIGNED", title: `Restarted: ${t.title}`, href: `/dashboard?task=${dup.id}`, taskId: dup.id, chat: false });
    void import("@/google/queue").then((q) => q.processPending()).catch(() => undefined);
    done(dup.id);
    done(t.id);
    return { taskId: dup.id };
  });
}
