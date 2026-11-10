/** Shared helpers for the task-domain integration tests (not a test file). */
import { testDb } from "../helpers/db";
import type { RecurrenceInput } from "@/server/tasks/schema";

export type TaskInputOverrides = Partial<{
  title: string;
  type: "WORK" | "MEETING";
  clientId: string;
  assigneeIds: string[];
  allocatedMinutes: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  /** "Repeat this task" (ADR 0010): fields a frequency doesn't use may be left out. */
  recurrence: (Partial<RecurrenceInput> & Pick<RecurrenceInput, "freq">) | null;
  teamIds: string[];
  tagIds: string[];
  preferredAssigneeIds: string[];
  deadlineOnly: boolean;
  forClient: boolean;
}>;

/** A no-team ("legacy") work type: available to every team (ADR 0008), so fixtures can always pick it. */
export async function anyTeamWorkType() {
  return testDb.workType.upsert({ where: { name: "Test work" }, update: {}, create: { name: "Test work" } });
}

/**
 * Calls the createTask server action (current mocked session) and returns the created task id.
 * Team-first rules (ADR 0008): unless overridden, the task carries the assignees' team(s) (else the first team)
 * and a work type every team can use, so Admin-created tasks go to that team's Team Leader.
 */
export async function createTaskAs(clientId: string, assigneeIds: string[], overrides: TaskInputOverrides = {}) {
  const { createTask } = await import("@/server/tasks/create");
  let teamIds = overrides.teamIds;
  if (!teamIds) {
    const users = await testDb.user.findMany({ where: { id: { in: assigneeIds } }, select: { teamId: true } });
    teamIds = [...new Set(users.map((u) => u.teamId).filter((x): x is string => !!x))];
    if (!teamIds.length) teamIds = (await testDb.team.findMany({ take: 1, orderBy: { createdAt: "asc" }, select: { id: true } })).map((t) => t.id);
  }
  const tagIds = overrides.tagIds ?? (overrides.type === "MEETING" ? [] : [(await anyTeamWorkType()).id]);
  const res = await createTask({ title: "Test task", clientId, assigneeIds, allocatedMinutes: 60, ...overrides, teamIds, tagIds });
  if (!res.ok) throw new Error(`createTask failed: ${res.error}`);
  return res.data.taskId;
}

export async function loadTask(id: string) {
  return testDb.task.findUniqueOrThrow({ where: { id }, include: { assignees: true, sessions: true, requests: true, recurrenceRule: true } });
}

type LegacyUser = { id: string; role: "ADMIN" | "TEAM_LEADER" | "EXECUTIVE" | "HR" | "CA"; teamId?: string | null };

/**
 * A live WORK task created by a Team Leader or Executive the way it was before ADR 0021 (a Team Leader's work task is
 * now a proposal, and Executives create meetings only). Such rows still exist ("existing exec self-assigned tasks stay
 * as they are"), so tests about the lifecycle, the slot finder and inventory seed them directly — placed by the real
 * slot finder exactly as createTask placed them (Up next, a day, an explicit start, or a deadline day).
 */
export async function legacyWorkAs(by: LegacyUser, clientId: string, assigneeIds: string[], overrides: TaskInputOverrides = {}) {
  const { proposeSlot } = await import("@/server/scheduling/slot");
  const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
  const { getSettings } = await import("@/lib/settings");
  const { deadlineFields } = await import("@/server/tasks/deadline");
  const settings = await getSettings();
  const tz = settings.timezone;
  const minutes = overrides.allocatedMinutes ?? 60;
  const opts = { requesterRole: by.role, requesterId: by.id };
  let start: Date;
  let end: Date;
  const s = overrides.scheduledStart ?? null;
  if (overrides.deadlineOnly) {
    const f = deadlineFields(s!.slice(0, 10), tz, settings.workEndMinutes);
    start = f.scheduledStart;
    end = f.scheduledEnd;
  } else if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const r = await proposeSlotOnDay(assigneeIds, minutes, s, opts);
    start = r!.slot.start;
    end = r!.slot.end;
  } else if (s) {
    start = new Date(s);
    end = overrides.scheduledEnd ? new Date(overrides.scheduledEnd) : new Date(start.getTime() + minutes * 60000);
  } else {
    const slot = await proposeSlot(assigneeIds, minutes, opts);
    start = slot!.start;
    end = slot!.end;
  }
  const users = await testDb.user.findMany({ where: { id: { in: assigneeIds } }, select: { teamId: true } });
  const teamIds = overrides.teamIds ?? [...new Set(users.map((u) => u.teamId).filter((x): x is string => !!x))];
  const tagIds = overrides.tagIds ?? [(await anyTeamWorkType()).id];
  const selfAssigned = assigneeIds.length === 1 && assigneeIds[0] === by.id;
  const t = await testDb.task.create({
    data: {
      title: overrides.title ?? "Test task",
      clientId,
      createdById: by.id,
      assignedById: by.id,
      allocatedMinutes: overrides.deadlineOnly ? 0 : minutes,
      deadlineOnly: !!overrides.deadlineOnly,
      scheduledStart: start,
      scheduledEnd: end,
      selfAssigned,
      status: "ASSIGNED",
      assignees: { create: assigneeIds.map((userId) => ({ userId })) },
      teams: { create: teamIds.map((teamId) => ({ teamId })) },
      tags: { create: tagIds.map((workTypeId) => ({ workTypeId })) },
    },
  });
  return t.id;
}

/** Wait for any fire-and-forget queue processing kicked off by an action to settle. */
export async function settle(ms = 50) {
  await new Promise((r) => setTimeout(r, ms));
}
