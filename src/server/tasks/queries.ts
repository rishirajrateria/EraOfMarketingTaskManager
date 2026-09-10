import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { rowColour, ACTIVE_STATUSES } from "@/server/tasks/state";
import type { DashboardData, PillGroup, TaskRow } from "@/server/tasks/types";

export const taskInclude = {
  client: { select: { id: true, name: true } },
  teams: { include: { team: { select: { id: true, name: true, colour: true } } } },
  assignees: { include: { user: { select: { id: true, name: true, avatar: true } } } },
  tags: { include: { workType: { select: { id: true, name: true, colour: true } } } },
  attachments: { select: { id: true, name: true, kind: true, url: true, driveFileId: true, durationSec: true } },
  children: { select: { id: true }, take: 1, orderBy: { createdAt: "desc" as const } },
  recurrenceRule: { select: { id: true, stopped: true } },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export function toRow(t: TaskWithRelations): TaskRow {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    type: t.type,
    status: t.status,
    colour: rowColour({ status: t.status, overdue: t.overdue, doubtRaised: t.doubtRaised, type: t.type }),
    overdue: t.overdue,
    important: t.important,
    priority: t.priority,
    doubtRaised: t.doubtRaised,
    doubtNote: t.doubtNote,
    reviewRequested: t.reviewRequested,
    reviewNote: t.reviewNote,
    paused: t.status === "PAUSED",
    recurring: !!t.recurrenceRule && !t.recurrenceRule.stopped,
    selfAssigned: t.selfAssigned,
    protected: t.protected,
    client: t.client,
    teams: t.teams.map((x) => x.team),
    assignees: t.assignees.map((a) => a.user),
    tags: t.tags.map((x) => x.workType),
    allocatedMinutes: t.allocatedMinutes,
    scheduledStart: t.scheduledStart?.toISOString() ?? null,
    scheduledEnd: t.scheduledEnd?.toISOString() ?? null,
    actualStart: t.actualStart?.toISOString() ?? null,
    actualEnd: t.actualEnd?.toISOString() ?? null,
    driveFolderUrl: t.driveFolderUrl,
    meetLink: t.meetLink,
    meetActive: t.meetActive,
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
  return rows.map(toRow);
}

export async function getTaskRow(user: SessionUser, id: string): Promise<TaskRow | null> {
  const t = await prisma.task.findFirst({ where: { id, deletedAt: null, ...scopeWhere(user) }, include: taskInclude });
  return t ? toRow(t) : null;
}

/** Can this user see the task at all? */
export async function canView(user: SessionUser, taskId: string) {
  const t = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null, ...scopeWhere(user) }, select: { id: true } });
  return !!t;
}

function sum(rows: TaskRow[]) {
  return rows.reduce((s, t) => s + (t.type === "WORK" ? t.allocatedMinutes : 0), 0);
}

/** Time-status pills (SPEC §5.1): sums of allocatedMinutes of non-completed tasks in scope. */
export async function buildPills(user: SessionUser, tasks: TaskRow[], tz: string, now = new Date()): Promise<PillGroup[]> {
  const open = tasks.filter((t) => t.status !== "COMPLETED");
  const { dateKey, zonedStartOfDay } = await import("@/lib/time");
  const { addDays } = await import("date-fns");
  const todayKey = dateKey(now, tz);
  const tomorrowKey = dateKey(addDays(zonedStartOfDay(now, tz), 1), tz);
  const byDate = async (): Promise<PillGroup> => {
    let b4Leave = 0;
    try {
      const { b4LeaveMinutes } = await import("@/server/inventory/queries");
      b4Leave = await b4LeaveMinutes(user.id);
    } catch {
      b4Leave = 0;
    }
    return {
      key: "date",
      label: "Date",
      items: [
        { id: "date:today", label: "Today", minutes: sum(open.filter((t) => t.scheduledStart && dateKey(new Date(t.scheduledStart), tz) === todayKey)) },
        { id: "date:tomorrow", label: "Tomorrow", minutes: sum(open.filter((t) => t.scheduledStart && dateKey(new Date(t.scheduledStart), tz) === tomorrowKey)) },
        { id: "date:b4leave", label: "B4Leave", minutes: b4Leave },
        { id: "date:all", label: "All time", minutes: sum(open) },
      ],
    };
  };
  const byClient = (): PillGroup => {
    const m = new Map<string, { label: string; minutes: number }>();
    for (const t of open) {
      const cur = m.get(t.client.id) ?? { label: t.client.name, minutes: 0 };
      cur.minutes += t.type === "WORK" ? t.allocatedMinutes : 0;
      m.set(t.client.id, cur);
    }
    return { key: "client", label: "Client", items: [...m].map(([id, v]) => ({ id: `client:${id}`, label: v.label, minutes: v.minutes })) };
  };
  if (user.role === "ADMIN") {
    const teams = new Map<string, { label: string; minutes: number }>();
    const people = new Map<string, { label: string; minutes: number }>();
    for (const t of open) {
      for (const team of t.teams) {
        const cur = teams.get(team.id) ?? { label: team.name, minutes: 0 };
        cur.minutes += t.type === "WORK" ? t.allocatedMinutes : 0;
        teams.set(team.id, cur);
      }
      for (const a of t.assignees) {
        const cur = people.get(a.id) ?? { label: a.name.split(" ")[0]!, minutes: 0 };
        cur.minutes += t.type === "WORK" ? t.allocatedMinutes : 0;
        people.set(a.id, cur);
      }
    }
    return [
      { key: "team", label: "Team", items: [...teams].map(([id, v]) => ({ id: `team:${id}`, label: v.label, minutes: v.minutes })) },
      { key: "person", label: "Person", items: [...people].map(([id, v]) => ({ id: `person:${id}`, label: v.label, minutes: v.minutes })) },
      byClient(),
    ];
  }
  if (user.role === "TEAM_LEADER") {
    const people = new Map<string, { label: string; minutes: number }>();
    for (const t of open) {
      for (const a of t.assignees) {
        if (a.id === user.id) continue;
        const cur = people.get(a.id) ?? { label: a.name.split(" ")[0]!, minutes: 0 };
        cur.minutes += t.type === "WORK" ? t.allocatedMinutes : 0;
        people.set(a.id, cur);
      }
    }
    return [
      { key: "person", label: "Executive", items: [...people].map(([id, v]) => ({ id: `person:${id}`, label: v.label, minutes: v.minutes })) },
      await byDate(),
      byClient(),
    ];
  }
  return [await byDate(), byClient()];
}

export async function dashboardData(user: SessionUser): Promise<DashboardData> {
  if (user.role !== "ADMIN" && user.role !== "TEAM_LEADER" && user.role !== "EXECUTIVE") throw new Error("No task dashboard for this role");
  const settings = await getSettings();
  const [tasks, workTypes, clients, teams, people] = await Promise.all([
    listTasks(user, { includeCompleted: true }),
    prisma.workType.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, colour: true } }),
    prisma.client.findMany({ where: { active: true, visibleInFilters: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.team.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, colour: true } }),
    prisma.user.findMany({
      where: { active: true, role: { in: ["ADMIN", "TEAM_LEADER", "EXECUTIVE"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, role: true, teamId: true, teamLeaderId: true },
    }),
  ]);
  const pills = await buildPills(user, tasks, settings.timezone);
  let row1: DashboardData["row1"];
  let row2: DashboardData["row2"];
  if (user.role === "ADMIN") {
    row1 = teams.map((t) => ({ id: t.id, label: t.name }));
    row2 = clients.map((c) => ({ id: c.id, label: c.name }));
  } else if (user.role === "TEAM_LEADER") {
    row1 = people.filter((p) => p.teamLeaderId === user.id).map((p) => ({ id: p.id, label: p.name.split(" ")[0]! }));
    row2 = clients.map((c) => ({ id: c.id, label: c.name }));
  } else {
    row1 = clients.map((c) => ({ id: c.id, label: c.name }));
    row2 = workTypes.map((w) => ({ id: w.id, label: w.name }));
  }
  return {
    role: user.role,
    tasks,
    pills,
    row1,
    row2,
    workTypes,
    clients,
    teams,
    people,
    me: { id: user.id, role: user.role, teamId: user.teamId },
    tz: settings.timezone,
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
