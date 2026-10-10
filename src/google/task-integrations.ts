/**
 * Per-task Google automation (SPEC §8, ADR 0015): Drive folder (+ "Meeting notes"), Calendar + Meet, the Meet space
 * config (open access + Gemini notes), Chat space, propagation of edits, and teardown on delete. Meet, Drive and Chat
 * live until the task is deleted — completing a task no longer touches them.
 */
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { enqueue, registerHandler } from "@/google/queue";
import * as Drive from "@/google/drive";
import * as Cal from "@/google/calendar";
import * as Chat from "@/google/chat";
import * as Meet from "@/google/meet";
import { ensureTaskFolder } from "@/google/task-folder";
import { fmtDateTime } from "@/lib/time";
import { meetingAttendees, readMeetingOptions } from "@/server/tasks/meeting";
import { workTaskPeople } from "@/server/tasks/task-people";

let registered = false;

async function taskContext(taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      client: true,
      assignees: { include: { user: { include: { teamLeader: { select: { email: true } } } } } },
      teams: { include: { team: { include: { leader: { select: { email: true } }, members: { select: { email: true, role: true, active: true } } } } } },
      createdBy: { select: { email: true } },
    },
  });
  if (!task) throw new Error("Task not found");
  if (task.type === "MEETING") {
    // Meetings (ADR 0012): exactly the invitees — the organiser, internal assignees and external guests.
    const internal = meetingAttendees([task.createdBy.email, ...task.assignees.map((a) => a.user.email)], []);
    return { task, emails: meetingAttendees(internal, task.guestEmails), internal };
  }
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { email: true } });
  const people = workTaskPeople({
    assignees: task.assignees.map((a) => ({ email: a.user.email, teamLeaderEmail: a.user.teamLeader?.email })),
    teamMembers: task.teams.flatMap((x) => x.team.members),
    teamLeaderEmails: task.teams.map((x) => x.team.leader?.email),
    creatorEmail: task.createdBy.email,
    adminEmails: admins.map((a) => a.email),
  });
  return { task, emails: people.calendar, internal: people.internal };
}

/** After a Meet link appears (event created, or Meet switched on in a meeting's options), configure its space. */
async function queueMeetConfig(taskId: string, meetLink: string | null) {
  const code = Meet.meetingCodeFromLink(meetLink);
  if (code) await enqueue("MEET_CONFIG", `meetcfg:${taskId}:${code}`, {}, { taskId });
}

const eventSummary = (task: { type: string; title: string }) => `${task.type === "MEETING" ? "Meeting" : "Task"}: ${task.title}`;
/** Client name + the description as plain text (the agenda for meetings). */
const eventDescription = (task: { client: { name: string }; description: string }) => `${task.client.name}\n${task.description.replace(/<[^>]+>/g, "")}`.trim();

export function registerTaskIntegrationHandlers() {
  if (registered) return;
  registered = true;

  registerHandler("DRIVE_FOLDER", async (_p, job) => {
    const { internal: emails } = await taskContext(job.taskId!); // never external guests
    const folder = await ensureTaskFolder(job.taskId!);
    await Drive.shareWith(folder.id, emails, "writer");
    return folder;
  });

  registerHandler("CALENDAR_EVENT", async (_p, job) => {
    const { task, emails } = await taskContext(job.taskId!);
    if (task.calendarEventId) return { id: task.calendarEventId };
    const start = task.scheduledStart ?? new Date();
    const end = task.scheduledEnd ?? new Date(start.getTime() + task.allocatedMinutes * 60000);
    const options = task.type === "MEETING" ? readMeetingOptions(task.meetingOptions) : null;
    const ev = await Cal.createEvent({
      summary: eventSummary(task),
      description: eventDescription(task),
      start,
      end,
      attendees: emails,
      withMeet: true,
      requestId: `task-${task.id}`,
      options,
      timeZone: (await getSettings()).timezone,
    });
    await prisma.task.update({
      where: { id: task.id },
      data: { calendarEventId: ev.eventId, meetLink: ev.meetLink, meetActive: !!ev.meetLink },
    });
    await queueMeetConfig(task.id, ev.meetLink);
    return ev;
  });

  // Meet REST API v2 (ADR 0015): anyone with the link joins without knocking; Gemini notes + transcripts ON.
  // Refusals (no Gemini in the edition, scope not delegated, …) are warnings in the job result, never failures.
  registerHandler("MEET_CONFIG", async (_p, job) => {
    const task = await prisma.task.findUnique({ where: { id: job.taskId! }, select: { id: true, meetLink: true, deletedAt: true } });
    if (!task?.meetLink || task.deletedAt) return { skipped: "no Meet link" };
    const res = await Meet.configureTaskSpace(task.meetLink);
    if (res.spaceName) await prisma.task.update({ where: { id: task.id }, data: { meetSpaceName: res.spaceName } });
    if (res.warnings.length) console.warn(`[meet] task ${task.id}: ${res.warnings.join("; ")}`);
    return res;
  });

  registerHandler("CHAT_SPACE", async (_p, job) => {
    const { task, internal: emails } = await taskContext(job.taskId!); // never external guests
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
    const options = task.type === "MEETING" ? readMeetingOptions(task.meetingOptions) : null;
    // Meet toggled in the meeting options: add a conference when there is none, remove it when switched off.
    const meet = options ? (options.withMeet && !task.meetLink ? "add" : !options.withMeet && task.meetLink ? "remove" : undefined) : undefined;
    const res = await Cal.updateEvent(task.calendarEventId, {
      summary: eventSummary(task),
      ...(task.type === "MEETING" ? { description: eventDescription(task) } : {}),
      start: task.scheduledStart ?? undefined,
      end: task.scheduledEnd ?? undefined,
      attendees: emails,
      options,
      timeZone: (await getSettings()).timezone,
      meet,
      requestId: `task-${task.id}-meet-${Date.now()}`,
    });
    if (res) {
      await prisma.task.update({ where: { id: task.id }, data: { meetLink: res.meetLink, meetActive: !!res.meetLink, ...(res.meetLink ? {} : { meetSpaceName: null }) } });
      await queueMeetConfig(task.id, res.meetLink);
    }
    return { updated: true, attendees: emails.length };
  });

  registerHandler("DRIVE_SHARE", async (_p, job) => {
    const { task, internal: emails } = await taskContext(job.taskId!); // never external guests
    if (!task.driveFolderId) return null;
    await Drive.shareWith(task.driveFolderId, emails, "writer");
    return { shared: emails.length };
  });

  registerHandler("CHAT_MEMBERS", async (_p, job) => {
    const { task, internal: emails } = await taskContext(job.taskId!); // never external guests
    if (!task.chatSpaceId) return null;
    await Chat.addMembers(task.chatSpaceId, emails);
    return { members: emails.length };
  });
}

/**
 * Queue the Google set (ADR 0015): every task gets a Drive folder (+ "Meeting notes") and a Calendar event with Meet
 * (then MEET_CONFIG); work tasks also get a Chat space.
 */
export async function queueTaskCreation(taskId: string, type: "WORK" | "MEETING", tx?: Parameters<typeof enqueue>[4]) {
  await enqueue("DRIVE_FOLDER", `drive:${taskId}`, {}, { taskId }, tx);
  await enqueue("CALENDAR_EVENT", `cal:${taskId}`, {}, { taskId }, tx);
  if (type === "WORK") await enqueue("CHAT_SPACE", `chat:${taskId}`, {}, { taskId }, tx);
}

/** Task edits propagate to Calendar, Chat membership and Drive sharing (SPEC §8). */
export async function queueTaskPropagation(taskId: string, tx?: Parameters<typeof enqueue>[4]) {
  const stamp = Date.now();
  await enqueue("CALENDAR_UPDATE", `calupd:${taskId}:${stamp}`, {}, { taskId }, tx);
  await enqueue("DRIVE_SHARE", `drvshare:${taskId}:${stamp}`, {}, { taskId }, tx);
  await enqueue("CHAT_MEMBERS", `chatmem:${taskId}:${stamp}`, {}, { taskId }, tx);
}

export type TeardownResult = { removed: string[]; kept: string[]; warnings: string[] };

/**
 * Delete-task teardown (ADR 0015 — everything goes): pending Google jobs are cancelled, the Meet space is ended and
 * locked (Google can't delete a Meet link), the Calendar event deleted, the Drive folder moved to the Drive trash and
 * the Chat space deleted. A folder / space still used by another live task (a restarted copy that reuses the
 * workspace) is kept. Each step is independent; failures come back as warnings.
 */
export async function teardownTask(taskId: string): Promise<TeardownResult> {
  const out: TeardownResult = { removed: [], kept: [], warnings: [] };
  await prisma.integrationJob.updateMany({ where: { taskId, status: "PENDING" }, data: { status: "FAILED", lastError: "Task deleted" } });
  const t = await prisma.task.findUnique({
    where: { id: taskId },
    select: { calendarEventId: true, chatSpaceId: true, driveFolderId: true, meetLink: true, meetSpaceName: true },
  });
  if (!t) return out;
  const step = async (label: string, fn: () => Promise<unknown>) => {
    try {
      const warnings = await fn();
      if (Array.isArray(warnings) && warnings.length) out.warnings.push(...(warnings as string[]));
      else out.removed.push(label);
    } catch (e) {
      out.warnings.push(`${label}: ${Meet.googleReason(e)}`);
    }
  };
  const sharedWith = async (field: "driveFolderId" | "chatSpaceId", value: string) =>
    (await prisma.task.count({ where: { id: { not: taskId }, deletedAt: null, [field]: value } })) > 0;

  if (t.meetSpaceName || t.meetLink) await step("Meet link", () => Meet.lockTaskSpace(t.meetSpaceName ?? t.meetLink!));
  if (t.calendarEventId) await step("Calendar event", () => Cal.deleteEvent(t.calendarEventId!));
  if (t.driveFolderId) {
    if (await sharedWith("driveFolderId", t.driveFolderId)) out.kept.push("Drive folder (used by the restarted copy)");
    else await step("Drive folder", () => Drive.trashFile(t.driveFolderId!));
  }
  if (t.chatSpaceId) {
    if (await sharedWith("chatSpaceId", t.chatSpaceId)) out.kept.push("Chat space (used by the restarted copy)");
    else await step("Chat space", () => Chat.deleteSpace(t.chatSpaceId!));
  }
  return out;
}
