import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { rowColour, ACTIVE_STATUSES } from "@/server/tasks/state";
import { describeRecord } from "@/server/tasks/recurrence";
import { DEFAULT_TZ } from "@/lib/time";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { readMeetingOptions } from "@/server/tasks/meeting";
import { hidesClientContact, shapeClients, shapePeople, splitClientGuests } from "@/server/tasks/contact-privacy";
import { reviewFieldsOf } from "@/server/tasks/review-fields";

export const taskInclude = {
  // email / contact only to tell the client's own meeting guests apart (never copied onto the row as such).
  client: { select: { id: true, name: true, email: true, contact: true } },
  teams: { include: { team: { select: { id: true, name: true, colour: true } } } },
  assignees: { include: { user: { select: { id: true, name: true, avatar: true } } } },
  tags: { include: { workType: { select: { id: true, name: true, colour: true } } }, orderBy: { workType: { name: "asc" } } },
  attachments: { select: { id: true, name: true, kind: true, url: true, driveFileId: true, durationSec: true } },
  children: { select: { id: true }, take: 1, orderBy: { createdAt: "desc" as const } },
  meetingNotes: { select: { id: true, kind: true, docUrl: true, createdAt: true }, orderBy: { createdAt: "desc" as const } },
  recurrenceRule: {
    select: { id: true, stopped: true, frequency: true, interval: true, byWeekday: true, endDate: true, repeatFreq: true, monthDay: true, nthWeek: true, nthWeekday: true, yearMonth: true, yearDay: true, endAfterCount: true, anchorDate: true },
  },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

/** `hideClientContact` (Team Leader / Executive, ADR 0017): the client's own meeting-guest addresses are left out. */
export function toRow(t: TaskWithRelations, opts: { hideClientContact?: boolean } = {}): TaskRow {
  const guests = splitClientGuests(t.guestEmails, t.client, !!opts.hideClientContact);
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    type: t.type,
    status: t.status,
    colour: rowColour({ status: t.status, overdue: t.overdue, doubtRaised: t.doubtRaised, type: t.type, scheduledStart: t.scheduledStart }),
    overdue: t.overdue,
    important: t.important,
    priority: t.priority,
    doubtRaised: t.doubtRaised,
    doubtNote: t.doubtNote,
    reviewRequested: t.reviewRequested,
    reviewNote: t.reviewNote,
    reviewFields: reviewFieldsOf(t),
    paused: t.status === "PAUSED",
    recurring: !!t.recurrenceRule && !t.recurrenceRule.stopped,
    repeatText: t.recurrenceRule && !t.recurrenceRule.stopped ? describeRecord(t.recurrenceRule, t.scheduledStart, DEFAULT_TZ) : null,
    selfAssigned: t.selfAssigned,
    protected: t.protected,
    client: { id: t.client.id, name: t.client.name },
    teams: t.teams.map((x) => x.team),
    assignees: t.assignees.map((a) => a.user),
    preferredAssigneeIds: t.preferredAssigneeIds,
    tags: t.tags.map((x) => x.workType),
    workTypeId: t.tags[0]?.workType.id ?? null,
    allocatedMinutes: t.allocatedMinutes,
    scheduledStart: t.scheduledStart?.toISOString() ?? null,
    scheduledEnd: t.scheduledEnd?.toISOString() ?? null,
    actualStart: t.actualStart?.toISOString() ?? null,
    actualEnd: t.actualEnd?.toISOString() ?? null,
    driveFolderUrl: t.driveFolderUrl,
    meetLink: t.meetLink,
    meetActive: t.meetActive,
    meetingNotesUrl: t.meetNotesFolderId ? `https://drive.google.com/drive/folders/${t.meetNotesFolderId}` : null,
    meetingNotes: t.meetingNotes.map((n) => ({ id: n.id, kind: n.kind, url: n.docUrl, createdAt: n.createdAt.toISOString() })),
    guestEmails: guests.guestEmails,
    clientGuestCount: guests.clientGuestCount,
    meetingOptions: t.type === "MEETING" ? readMeetingOptions(t.meetingOptions) : null,
    chatSpaceUrl: t.chatSpaceUrl,
    calendarEventId: t.calendarEventId,
    integrationError: t.integrationError,
    finishRequestedAt: t.finishRequestedAt?.toISOString() ?? null,
    parentTaskId: t.parentTaskId,
    childTaskId: t.children[0]?.id ?? null,
    attachments: t.attachments.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      url: a.url ?? `/api/files/attachment/${a.id}`,
      durationSec: a.durationSec,
    })),
    createdById: t.createdById,
    createdAt: t.createdAt.toISOString(),
  };
}

/** Visibility scope per role (SPEC §2 "Dashboard"). */
export function scopeWhere(user: SessionUser): Prisma.TaskWhereInput {
  if (user.role === "ADMIN") return {};
  if (user.role === "TEAM_LEADER") {
    return {
      OR: [
        { assignees: { some: { userId: user.id } } },
        { assignees: { some: { user: { teamLeaderId: user.id } } } },
        ...(user.teamId ? [{ teams: { some: { teamId: user.teamId } } }] : []),
        { createdById: user.id },
      ],
    };
  }
  if (user.role === "EXECUTIVE") return { assignees: { some: { userId: user.id } } };
  return { id: "__none__" };
}

export async function listTasks(user: SessionUser, opts: { includeCompleted?: boolean } = {}): Promise<TaskRow[]> {
  const rows = await prisma.task.findMany({
    where: {
      deletedAt: null,
      ...scopeWhere(user),
      ...(opts.includeCompleted ? {} : { status: { in: ACTIVE_STATUSES } }),
    },
    include: taskInclude,
    orderBy: [{ scheduledStart: "asc" }, { createdAt: "desc" }],
    take: 500,
  });
  return rows.map((t) => toRow(t, { hideClientContact: hidesClientContact(user.role) }));
}

export async function getTaskRow(user: SessionUser, id: string): Promise<TaskRow | null> {
  const t = await prisma.task.findFirst({ where: { id, deletedAt: null, ...scopeWhere(user) }, include: taskInclude });
  return t ? toRow(t, { hideClientContact: hidesClientContact(user.role) }) : null;
}

/** Can this user see the task at all? */
export async function canView(user: SessionUser, taskId: string) {
  const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null, ...scopeWhere(user) }, select: { id: true } });
  return !!t;
}

export async function dashboardData(user: SessionUser): Promise<DashboardData> {
  if (user.role !== "ADMIN" && user.role !== "TEAM_LEADER" && user.role !== "EXECUTIVE") throw new Error("No task dashboard for this role");
  const settings = await getSettings();
  const [tasks, workTypeRows, clients, teams, peopleRows] = await Promise.all([
    listTasks(user, { includeCompleted: true }),
    prisma.workType.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, colour: true, teams: { select: { id: true } } } }),
    prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, visibleInFilters: true, email: true, contact: true, phone: true, whatsapp: true } }),
    prisma.team.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, colour: true, leaderId: true } }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["ADMIN", "TEAM_LEADER", "EXECUTIVE"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, teamId: true, teamLeaderId: true, phone: true, email: true, specialities: { select: { id: true } } },
    }),
  ]);
  const workTypes = workTypeRows.map(({ teams: wt, ...w }) => ({ ...w, teamIds: wt.map((t) => t.id) }));
  // Contact details only for the people this viewer may contact (ADR 0017 privacy).
  const people = shapePeople(user, peopleRows.map(({ specialities, ...p }) => ({ ...p, specialityIds: specialities.map((w) => w.id) })), tasks, teams);
  let nextLeaveKey: string | null = null;
  try {
    const { nextApprovedLeave } = await import("@/server/inventory/queries");
    const { dateKey } = await import("@/lib/time");
    const leave = await nextApprovedLeave(user.id);
    nextLeaveKey = leave ? dateKey(leave.from, "UTC") : null;
  } catch {
    nextLeaveKey = null;
  }
  // Filter pills only list clients that already have a task (SPEC §5.4); the add-task form gets every active client.
  const filterClients = clients.filter((c) => c.visibleInFilters);
  let row1: DashboardData["row1"];
  let row2: DashboardData["row2"];
  if (user.role === "ADMIN") {
    row1 = teams.map((t) => ({ id: t.id, label: t.name }));
    row2 = filterClients.map((c) => ({ id: c.id, label: c.name }));
  } else if (user.role === "TEAM_LEADER") {
    row1 = people.filter((p) => p.teamLeaderId === user.id).map((p) => ({ id: p.id, label: p.name.split(" ")[0]! }));
    row2 = filterClients.map((c) => ({ id: c.id, label: c.name }));
  } else {
    row1 = filterClients.map((c) => ({ id: c.id, label: c.name }));
    // Executives see only their own team's work types (plus legacy ones with no team).
    row2 = workTypes.filter((w) => !w.teamIds.length || (!!user.teamId && w.teamIds.includes(user.teamId))).map((w) => ({ id: w.id, label: w.name }));
  }
  return {
    role: user.role,
    tasks,
    row1,
    row2,
    workTypes,
    clients: shapeClients(user, clients),
    teams,
    people,
    me: { id: user.id, role: user.role, teamId: user.teamId, name: user.name ?? peopleRows.find((p) => p.id === user.id)?.name ?? "" },
    companyName: settings.companyName,
    tz: settings.timezone,
    nextLeaveKey,
  };
}

/** Allocated hours in a period for an assignee (Add-task blue area, SPEC §6). */
export async function periodLoad(assigneeIds: string[], from: Date, to: Date) {
  const rows = await prisma.task.findMany({
    where: {
      deletedAt: null,
      type: "WORK",
      status: { in: ACTIVE_STATUSES },
      assignees: { some: { userId: { in: assigneeIds } } },
      scheduledStart: { gte: from, lt: to },
    },
    select: { allocatedMinutes: true },
  });
  return { minutes: rows.reduce((s, r) => s + r.allocatedMinutes, 0), count: rows.length };
}
