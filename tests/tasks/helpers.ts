/** Shared helpers for the task-domain integration tests (not a test file). */
import { testDb } from "../helpers/db";

export type TaskInputOverrides = Partial<{
  title: string;
  type: "WORK" | "MEETING";
  clientId: string;
  assigneeIds: string[];
  allocatedMinutes: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  recurrence: { frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM"; interval?: number; byWeekday?: number[]; trigger?: "ON_COMPLETE" | "ON_SCHEDULE"; endDate?: string | null } | null;
  teamIds: string[];
  tagIds: string[];
  preferredAssigneeIds: string[];
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

/** Wait for any fire-and-forget queue processing kicked off by an action to settle. */
export async function settle(ms = 50) {
  await new Promise((r) => setTimeout(r, ms));
}
