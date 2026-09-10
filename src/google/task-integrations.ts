/**
 * Per-task Google automation (SPEC §8): Drive folder, Calendar+Meet, Chat space,
 * propagation of edits, and teardown on delete/complete.
 */
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { enqueue, registerHandler } from "@/google/queue";
import * as Drive from "@/google/drive";
import * as Cal from "@/google/calendar";
import * as Chat from "@/google/chat";
import { fmtDateTime } from "@/lib/time";

let registered = false;

async function taskContext(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      client: true,
      assignees: { include: { user: { include: { teamLeader: true } } } },
    },
  });
  if (!task) throw new Error("Task not found");
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { email: true } });
  const emails = new Set<string>();
  for (const a of task.assignees) {
    emails.add(a.user.email);
    if (a.user.teamLeader?.email) emails.add(a.user.teamLeader.email);
  }
  admins.forEach((a) => emails.add(a.email));
  return { task, emails: Array.from(emails) };
}

export function registerTaskIntegrationHandlers() {
  if (registered) return;
  registered = true;

  registerHandler("DRIVE_FOLDER", async (_p, job) => {
    const { task, emails } = await taskContext(job.taskId!);
    if (task.driveFolderId) return { id: task.driveFolderId };
    const folder = await Drive.ensurePath(["Clients", task.client.name, `${task.title} – ${task.id.slice(-6)}`]);
    await Drive.shareWith(folder.id, emails, "writer");
    await prisma.task.update({ where: { id: task.id }, data: { driveFolderId: folder.id, driveFolderUrl: folder.url } });
    await prisma.client.update({ where: { id: task.clientId }, data: { driveFolderId: task.client.driveFolderId ?? (await Drive.ensurePath(["Clients", task.client.name])).id } });
    return folder;
  });

  registerHandler("CALENDAR_EVENT", async (_p, job) => {
    const { task, emails } = await taskContext(job.taskId!);
    if (task.calendarEventId) return { id: task.calendarEventId };
    const start = task.scheduledStart ?? new Date();
    const end = task.scheduledEnd ?? new Date(start.getTime() + task.allocatedMinutes * 60000);
    const ev = await Cal.createEvent({
      summary: `${task.type === "MEETING" ? "Meeting" : "Task"}: ${task.title}`,
      description: `${task.client.name}\n${task.description.replace(/<[^>]+>/g, "")}`.trim(),
      start,
      end,
      attendees: emails,
      withMeet: true,
      requestId: `task-${task.id}`,
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { calendarEventId: ev.eventId, meetLink: ev.meetLink, meetActive: !!ev.meetLink },
    });
    return ev;
  });

  registerHandler("CHAT_SPACE", async (_p, job) => {
    const { task, emails } = await taskContext(job.taskId!);
    if (task.chatSpaceId) return { id: task.chatSpaceId };
    const space = await Chat.createSpace(task.title, emails, `task-${task.id}`);
    await prisma.task.update({ where: { id: task.id }, data: { chatSpaceId: space.name, chatSpaceUrl: space.url } });
    const fresh = await prisma.task.findUnique({ where: { id: task.id } });
    const settings = await getSettings();
    await Chat.postMessage(
      space.name,
      [
        `📋 *${task.title}* — ${task.client.name}`,
        `Allocated: ${Math.round(task.allocatedMinutes / 60 * 10) / 10}h · ${fmtDateTime(task.scheduledStart, settings.timezone)} → ${fmtDateTime(task.scheduledEnd, settings.timezone)}`,
        fresh?.driveFolderUrl ? `📁 Drive: ${fresh.driveFolderUrl}` : "",
        fresh?.meetLink ? `🎥 Meet: ${fresh.meetLink}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return space;
  });

  registerHandler("CALENDAR_UPDATE", async (_p, job) => {
    const { task, emails } = await taskContext(job.taskId!);
    if (!task.calendarEventId) return null;
    await Cal.updateEvent(task.calendarEventId, {
      summary: `${task.type === "MEETING" ? "Meeting" : "Task"}: ${task.title}`,
      start: task.scheduledStart ?? undefined,
      end: task.scheduledEnd ?? undefined,
      attendees: emails,
    });
    return { updated: true };
  });

  registerHandler("DRIVE_SHARE", async (_p, job) => {
    const { task, emails } = await taskContext(job.taskId!);
    if (!task.driveFolderId) return null;
    await Drive.shareWith(task.driveFolderId, emails, "writer");
    return { shared: emails.length };
  });

  registerHandler("CHAT_MEMBERS", async (_p, job) => {
    const { task, emails } = await taskContext(job.taskId!);
    if (!task.chatSpaceId) return null;
    await Chat.addMembers(task.chatSpaceId, emails);
    return { members: emails.length };
  });
}

/** Queue the full Work set (Drive → Calendar → Chat) or Meeting subset (Calendar only). */
export async function queueTaskCreation(taskId: string, type: "WORK" | "MEETING", tx?: Parameters<typeof enqueue>[4]) {
  if (type === "WORK") {
    await enqueue("DRIVE_FOLDER", `drive:${taskId}`, {}, { taskId }, tx);
    await enqueue("CALENDAR_EVENT", `cal:${taskId}`, {}, { taskId }, tx);
    await enqueue("CHAT_SPACE", `chat:${taskId}`, {}, { taskId }, tx);
  } else {
    await enqueue("CALENDAR_EVENT", `cal:${taskId}`, {}, { taskId }, tx);
  }
}

/** Task edits propagate to Calendar, Chat membership and Drive sharing (SPEC §8). */
export async function queueTaskPropagation(taskId: string, tx?: Parameters<typeof enqueue>[4]) {
  const stamp = Date.now();
  await enqueue("CALENDAR_UPDATE", `calupd:${taskId}:${stamp}`, {}, { taskId }, tx);
  await enqueue("DRIVE_SHARE", `drvshare:${taskId}:${stamp}`, {}, { taskId }, tx);
  await enqueue("CHAT_MEMBERS", `chatmem:${taskId}:${stamp}`, {}, { taskId }, tx);
}

/** On approve-complete: Meet link deactivated, Chat space kept (SPEC §7). */
export async function deactivateMeet(taskId: string) {
  const t = await prisma.task.findUnique({ where: { id: taskId }, select: { calendarEventId: true } });
  if (t?.calendarEventId) await Cal.endEventAndRemoveMeet(t.calendarEventId).catch(() => undefined);
  await prisma.task.update({ where: { id: taskId }, data: { meetActive: false } });
}

/** Delete-task sheet (SPEC §12). Calendar event is always removed. */
export async function teardownTask(taskId: string, opts: { chat: boolean; drive: boolean }) {
  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: { calendarEventId: true, chatSpaceId: true, driveFolderId: true },
  });
  if (!t) return;
  if (t.calendarEventId) await Cal.deleteEvent(t.calendarEventId).catch(() => undefined);
  if (opts.chat && t.chatSpaceId) await Chat.deleteSpace(t.chatSpaceId).catch(() => undefined);
  if (opts.drive && t.driveFolderId) await Drive.deleteFile(t.driveFolderId).catch(() => undefined);
  await prisma.task.update({
    where: { id: taskId },
    data: {
      calendarEventId: null,
      meetLink: null,
      meetActive: false,
      chatSpaceId: opts.chat ? null : t.chatSpaceId,
      chatSpaceUrl: opts.chat ? null : undefined,
      driveFolderId: opts.drive ? null : t.driveFolderId,
      driveFolderUrl: opts.drive ? null : undefined,
    },
  });
}
