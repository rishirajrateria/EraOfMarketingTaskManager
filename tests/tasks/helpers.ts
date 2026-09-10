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
}>;

/** Calls the createTask server action (current mocked session) and returns the created task id. */
export async function createTaskAs(clientId: string, assigneeIds: string[], overrides: TaskInputOverrides = {}) {
  const { createTask } = await import("@/server/tasks/create");
  const res = await createTask({ title: "Test task", clientId, assigneeIds, allocatedMinutes: 60, ...overrides });
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
