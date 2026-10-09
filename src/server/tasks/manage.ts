"use server";
import { prisma } from "@/lib/db";
import { requireUser, can, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { notify, taskStakeholderIds, publishTaskChanged } from "@/lib/notify";
import { bus } from "@/lib/events";
import { safeRevalidate } from "@/lib/revalidate";
import { canView } from "@/server/tasks/queries";
import { assignExecutivesSchema, taskUpdateSchema } from "@/server/tasks/schema";
import { assignableMembers, firstName } from "@/server/tasks/assignment";
import { validateAssignees } from "@/server/tasks/create";
import { queueTaskPropagation, teardownTask } from "@/google/task-integrations";
import { retryFailedForTask } from "@/google/queue";
import * as Drive from "@/google/drive";
import type { DashboardFilters } from "@/server/tasks/types";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { sanitizeDescription } from "@/lib/sanitize";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const attachmentSchema = z.object({
  taskId: z.string().min(1),
  kind: z.enum(["FILE", "VOICE_NOTE", "IMAGE"]).default("FILE"),
  durationSec: z.coerce.number().int().min(0).max(60 * 60).nullable().default(null),
});
const noteSchema = z.string().max(2000);
const filtersSchema = z.object({
  colours: z.array(z.enum(["white", "green", "yellow", "red", "grey"])).max(5),
  icons: z.array(z.enum(["paused", "doubt", "review", "important", "recurring", "restarted"])).max(6),
  row1: z.string().max(64).nullable(),
  row2: z.string().max(64).nullable(),
  pill: z.string().max(80).nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  quick: z.enum(["asc", "tomorrow", "today"]).nullable(),
  completed: z.boolean(),
  recurringOnly: z.boolean(),
  pausedOnly: z.boolean(),
});

/** Admin edit (SPEC §5.3). Editing clears the red review dot (SPEC §7). Propagates to Google. */
export async function updateTask(raw: unknown): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!can.editTask(user)) throw new ForbiddenError();
    const input = taskUpdateSchema.parse(raw);
    const t = await prisma.task.findUnique({ where: { id: input.id }, include: { assignees: true, teams: true, tags: true } });
    if (!t || t.deletedAt) throw new Error("Task not found");
    if (t.protected && t.createdById !== user.id) throw new ForbiddenError("This task is fixed by its owner");
    if (input.assigneeIds) await validateAssignees(user, input.assigneeIds, input.type ?? t.type);
    const start = input.scheduledStart === undefined ? undefined : input.scheduledStart ? new Date(input.scheduledStart) : null;
    let end = input.scheduledEnd === undefined ? undefined : input.scheduledEnd ? new Date(input.scheduledEnd) : null;
    if (start && end === undefined) end = new Date(start.getTime() + (input.allocatedMinutes ?? t.allocatedMinutes) * 60000);
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: t.id },
        data: {
          title: input.title,
          description: input.description === undefined ? undefined : sanitizeDescription(input.description),
          type: input.type,
          clientId: input.clientId,
          allocatedMinutes: input.allocatedMinutes,
          scheduledStart: start,
          scheduledEnd: end,
          important: input.important,
          priority: input.priority,
          reviewRequested: false,
          reviewNote: null,
          overdue: false,
          ...(input.assigneeIds ? { assignees: { deleteMany: {}, create: input.assigneeIds.map((userId) => ({ userId })) } } : {}),
          ...(input.teamIds ? { teams: { deleteMany: {}, create: input.teamIds.map((teamId) => ({ teamId })) } } : {}),
          ...(input.tagIds ? { tags: { deleteMany: {}, create: input.tagIds.map((workTypeId) => ({ workTypeId })) } } : {}),
        },
      });
      await tx.request.updateMany({
        where: { taskId: t.id, type: { in: ["REVIEW", "TIME_CHANGE"] }, status: "OPEN" },
        data: { status: "RESOLVED", resolvedById: user.id, resolvedAt: now, resolutionNote: "Task edited" },
      });
      if (input.clientId) await tx.client.update({ where: { id: input.clientId }, data: { visibleInFilters: true } });
    });
    await audit(user.id, "task.update", "Task", t.id, t, input);
    await queueTaskPropagation(t.id);
    const added = (input.assigneeIds ?? []).filter((id) => !t.assignees.some((a) => a.userId === id));
    if (added.length) await notify({ userIds: added, kind: "TASK_ASSIGNED", title: `Task assigned: ${input.title ?? t.title}`, href: `/dashboard?task=${t.id}`, taskId: t.id, chat: false });
    void import("@/google/queue").then((q) => q.processPending()).catch(() => undefined);
    void publishTaskChanged(t.id);
    bus.publish({ type: "requests.changed" });
    safeRevalidate("/dashboard", "/requests");
    return undefined;
  });
}

/**
 * Long-press → Assign executive (ADR 0008). Admin: any task; Team Leader: only tasks of their own team, and only
 * people of that team. Replaces the assignees, keeps Admin's preferences, and syncs Calendar / Drive / Chat members.
 */
export async function assignExecutives(taskId: string, userIds: string[]): Promise<ActionResult<{ assigneeIds: string[] }>> {
  return wrap(async () => {
    const user = await requireUser();
    if (user.role !== "ADMIN" && user.role !== "TEAM_LEADER") throw new ForbiddenError();
    const input = assignExecutivesSchema.parse({ taskId, userIds });
    const ids = Array.from(new Set(input.userIds));
    const t = await prisma.task.findUnique({ where: { id: input.taskId }, include: { assignees: true, teams: true } });
    if (!t || t.deletedAt) throw new Error("Task not found");
    if (t.status === "COMPLETED") throw new Error("This task is already completed");
    const taskTeams = t.teams.map((x) => x.teamId);
    let teamIds = taskTeams;
    if (user.role === "TEAM_LEADER") {
      if (!user.teamId || !taskTeams.includes(user.teamId)) throw new ForbiddenError("You can only assign tasks of your own team");
      teamIds = [user.teamId];
    }
    if (!teamIds.length) throw new Error("This task has no team — edit it and pick a team first");
    const members = await assignableMembers(teamIds);
    const outside = ids.filter((id) => !members.some((m) => m.id === id));
    if (outside.length) throw new ForbiddenError("Only people in this task's team can be assigned");
    const before = t.assignees.map((a) => a.userId);
    await prisma.task.update({
      where: { id: t.id },
      data: { assignedById: user.id, assignees: { deleteMany: {}, create: ids.map((userId) => ({ userId })) } },
    });
    await audit(user.id, "task.assignExecutives", "Task", t.id, { assigneeIds: before }, { assigneeIds: ids, preferredAssigneeIds: t.preferredAssigneeIds });
    await queueTaskPropagation(t.id); // Calendar attendees, Drive sharing, Chat members
    const added = ids.filter((id) => id !== user.id && !before.includes(id));
    if (added.length) {
      await notify({ userIds: added, kind: "TASK_ASSIGNED", title: `New task from ${firstName(user.name)}: ${t.title}`, href: `/dashboard?task=${t.id}`, taskId: t.id, chat: false });
    }
    void import("@/google/queue").then((q) => q.processPending()).catch(() => undefined);
    void publishTaskChanged(t.id);
    const removed = before.filter((id) => !ids.includes(id));
    if (removed.length) bus.publish({ type: "task.changed", taskId: t.id, userIds: removed });
    safeRevalidate("/dashboard");
    return { assigneeIds: ids };
  });
}

/** Admin: mark a self-assigned TL/Exec task as protected (resolves FIX_SELF_TASK request). */
export async function setTaskProtected(taskId: string, value: boolean): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!can.editTask(user)) throw new ForbiddenError();
    await prisma.task.update({ where: { id: taskId }, data: { protected: value } });
    await prisma.request.updateMany({ where: { taskId, type: "FIX_SELF_TASK", status: "OPEN" }, data: { status: value ? "APPROVED" : "REJECTED", resolvedById: user.id, resolvedAt: new Date() } });
    await audit(user.id, "task.protect", "Task", taskId, null, { protected: value });
    void publishTaskChanged(taskId);
    bus.publish({ type: "requests.changed" });
    safeRevalidate("/dashboard", "/requests");
    return undefined;
  });
}

/** Delete confirmation sheet (SPEC §12). Soft delete; Calendar/Meet always removed. */
export async function deleteTask(
  taskId: string,
  opts: { deleteChat: boolean; deleteDrive: boolean; deleteData: boolean },
): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!can.deleteTask(user)) throw new ForbiddenError();
    const t = await prisma.task.findUnique({ where: { id: taskId } });
    if (!t) throw new Error("Task not found");
    await teardownTask(taskId, { chat: opts.deleteChat, drive: opts.deleteDrive }).catch(() => undefined);
    await prisma.$transaction(async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: { deletedAt: new Date(), deletedById: user.id, meetActive: false } });
      if (opts.deleteData) {
        await tx.taskSession.deleteMany({ where: { taskId } });
        await tx.request.deleteMany({ where: { taskId } });
        await tx.taskAttachment.deleteMany({ where: { taskId } });
      }
    });
    await audit(user.id, "task.delete", "Task", taskId, t, opts);
    bus.publish({ type: "task.deleted", taskId });
    safeRevalidate("/dashboard", "/requests");
    return undefined;
  });
}

export async function retryIntegrations(taskId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!can.editTask(user)) throw new ForbiddenError();
    await retryFailedForTask(taskId);
    void import("@/google/queue").then((q) => q.processPending()).catch(() => undefined);
    void publishTaskChanged(taskId);
    return undefined;
  });
}

/** Star: Admin on any task; others only on tasks they created for themselves (task edits are otherwise Admin-only, SPEC §2). */
export async function toggleImportant(taskId: string): Promise<ActionResult<boolean>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!(await canView(user, taskId))) throw new ForbiddenError();
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { important: true, createdById: true, selfAssigned: true } });
    if (!can.editTask(user) && !(t.selfAssigned && t.createdById === user.id)) throw new ForbiddenError("Only Admin can star this task");
    await prisma.task.update({ where: { id: taskId }, data: { important: !t.important } });
    void publishTaskChanged(taskId);
    safeRevalidate("/dashboard");
    return !t.important;
  });
}

export async function saveFilters(filters: DashboardFilters): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    const clean = filtersSchema.parse(filters);
    await prisma.user.update({ where: { id: user.id }, data: { filterPrefs: clean as unknown as Prisma.InputJsonValue } });
    return undefined;
  });
}

/** Upload: creates the Drive folder immediately if needed, stores the file there (SPEC §6). */
export async function ensureTaskDriveFolder(taskId: string): Promise<ActionResult<{ url: string }>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!(await canView(user, taskId))) throw new ForbiddenError();
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: { client: true } });
    if (t.driveFolderUrl) return { url: t.driveFolderUrl };
    const folder = await Drive.ensurePath(["Clients", t.client.name, `${t.title} – ${t.id.slice(-6)}`]);
    await prisma.task.update({ where: { id: t.id }, data: { driveFolderId: folder.id, driveFolderUrl: folder.url } });
    await queueTaskPropagation(t.id);
    void publishTaskChanged(taskId);
    return { url: folder.url };
  });
}

export async function uploadAttachment(form: FormData): Promise<ActionResult<{ id: string; url: string }>> {
  return wrap(async () => {
    const user = await requireUser();
    const { taskId, kind, durationSec } = attachmentSchema.parse({
      taskId: form.get("taskId"),
      kind: form.get("kind") ?? "FILE",
      durationSec: form.get("durationSec") ?? null,
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file");
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error("File is larger than 20 MB");
    if (!(await canView(user, taskId))) throw new ForbiddenError();
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: { client: true } });
    let folderId = t.driveFolderId;
    if (!folderId) {
      const folder = await Drive.ensurePath(["Clients", t.client.name, `${t.title} – ${t.id.slice(-6)}`]);
      folderId = folder.id;
      await prisma.task.update({ where: { id: t.id }, data: { driveFolderId: folder.id, driveFolderUrl: folder.url } });
    }
    const data = Buffer.from(await file.arrayBuffer());
    let driveFileId: string | null = null;
    let url: string | null = null;
    try {
      const up = await Drive.uploadFile({ name: file.name, mimeType: file.type || "application/octet-stream", data, parentId: folderId });
      driveFileId = up.id;
      url = up.url;
    } catch {
      /* fall back to DB storage */
    }
    const att = await prisma.taskAttachment.create({
      data: {
        taskId,
        name: file.name,
        mimeType: file.type,
        kind,
        durationSec,
        sizeBytes: data.length,
        driveFileId,
        url: driveFileId && !process.env.GOOGLE_MOCK?.match(/^(1|true)$/i) ? url : null,
        data,
        uploadedById: user.id,
      },
    });
    await audit(user.id, "task.attach", "Task", taskId, null, { attachmentId: att.id, kind, name: file.name });
    void publishTaskChanged(taskId);
    safeRevalidate("/dashboard");
    return { id: att.id, url: att.url ?? `/api/files/attachment/${att.id}` };
  });
}

export async function deleteAttachment(id: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    const a = await prisma.taskAttachment.findUniqueOrThrow({ where: { id } });
    if (!(await canView(user, a.taskId))) throw new ForbiddenError();
    if (a.uploadedById !== user.id && user.role !== "ADMIN") throw new ForbiddenError();
    if (a.driveFileId) await Drive.deleteFile(a.driveFileId).catch(() => undefined);
    await prisma.taskAttachment.delete({ where: { id } });
    void publishTaskChanged(a.taskId);
    return undefined;
  });
}

/** Team leaders and executives can never "edit" — they raise a request; admins may also add a note to notify. */
export async function notifyTaskStakeholders(taskId: string, message: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!can.editTask(user)) throw new ForbiddenError();
    const text = noteSchema.min(1).parse(message);
    await notify({ userIds: await taskStakeholderIds(taskId, { includeAdmins: false }), kind: "GENERIC", title: text, taskId, href: `/dashboard?task=${taskId}` });
    return undefined;
  });
}
