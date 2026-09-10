"use server";
import { prisma } from "@/lib/db";
import { requireUser, can, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { notify, taskStakeholderIds } from "@/lib/notify";
import { bus } from "@/lib/events";
import { safeRevalidate } from "@/lib/revalidate";
import { canView } from "@/server/tasks/queries";
import { taskUpdateSchema } from "@/server/tasks/schema";
import { validateAssignees } from "@/server/tasks/create";
import { queueTaskPropagation, teardownTask } from "@/google/task-integrations";
import { retryFailedForTask } from "@/google/queue";
import * as Drive from "@/google/drive";
import type { DashboardFilters } from "@/server/tasks/types";
import type { Prisma } from "@prisma/client";

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
          description: input.description,
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
    bus.publish({ type: "task.changed", taskId: t.id });
    bus.publish({ type: "requests.changed" });
    safeRevalidate("/dashboard", "/requests");
    return undefined;
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
    bus.publish({ type: "task.changed", taskId });
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
    bus.publish({ type: "task.changed", taskId });
    return undefined;
  });
}

export async function toggleImportant(taskId: string): Promise<ActionResult<boolean>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!(await canView(user, taskId))) throw new ForbiddenError();
    const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { important: true } });
    await prisma.task.update({ where: { id: taskId }, data: { important: !t.important } });
    bus.publish({ type: "task.changed", taskId });
    safeRevalidate("/dashboard");
    return !t.important;
  });
}

export async function saveFilters(filters: DashboardFilters): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    await prisma.user.update({ where: { id: user.id }, data: { filterPrefs: filters as unknown as Prisma.InputJsonValue } });
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
    bus.publish({ type: "task.changed", taskId });
    return { url: folder.url };
  });
}

export async function uploadAttachment(form: FormData): Promise<ActionResult<{ id: string; url: string }>> {
  return wrap(async () => {
    const user = await requireUser();
    const taskId = String(form.get("taskId") ?? "");
    const kind = (String(form.get("kind") ?? "FILE") as "FILE" | "VOICE_NOTE" | "IMAGE");
    const durationSec = Number(form.get("durationSec") ?? 0) || null;
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file");
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
    bus.publish({ type: "task.changed", taskId });
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
    bus.publish({ type: "task.changed", taskId: a.taskId });
    return undefined;
  });
}

/** Team leaders and executives can never "edit" — they raise a request; admins may also add a note to notify. */
export async function notifyTaskStakeholders(taskId: string, message: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    if (!can.editTask(user)) throw new ForbiddenError();
    await notify({ userIds: await taskStakeholderIds(taskId, { includeAdmins: false }), kind: "GENERIC", title: message, taskId, href: `/dashboard?task=${taskId}` });
    return undefined;
  });
}
