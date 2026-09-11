"use server";
import { prisma } from "@/lib/db";
import { requireUser, type SessionUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { notify, publishTaskChanged } from "@/lib/notify";
import { safeRevalidate } from "@/lib/revalidate";
import { parseDateKey } from "@/lib/time";
import { getSettings } from "@/lib/settings";
import { proposeSlot, shiftDisplacedTasks, type SlotProposal } from "@/server/scheduling/slot";
import { queueTaskCreation } from "@/google/task-integrations";
import { taskInputSchema, type TaskInput } from "@/server/tasks/schema";
import { nextRunAt } from "@/server/tasks/recurrence";
import { ACTIVE_STATUSES } from "@/server/tasks/state";
import { sanitizeDescription } from "@/lib/sanitize";
import { z } from "zod";

const idsSchema = z.array(z.string().min(1)).max(50);

/** Assignment rules (SPEC §2): Admin→Team Leaders (or self), TL→own Executives (or self), Exec→self only. */
export async function validateAssignees(user: SessionUser, assigneeIds: string[], type: "WORK" | "MEETING") {
  const users = await prisma.user.findMany({ where: { id: { in: assigneeIds }, active: true }, select: { id: true, role: true, teamLeaderId: true, email: true } });
  if (users.length !== assigneeIds.length) throw new Error("Unknown or inactive assignee");
  for (const a of users) {
    if (a.id === user.id) continue;
    if (type === "MEETING") continue; // anyone with a dashboard may invite anyone to a meeting
    if (user.role === "ADMIN") {
      if (a.role === "TEAM_LEADER" || a.role === "ADMIN") continue;
      throw new ForbiddenError("Admin assigns Executives only via their Team Leader");
    }
    if (user.role === "TEAM_LEADER") {
      if (a.role === "EXECUTIVE" && a.teamLeaderId === user.id) continue;
      throw new ForbiddenError("Team Leaders may only assign their own Executives");
    }
    throw new ForbiddenError("Executives may only self-assign");
  }
  return users;
}

export type CreateResult = { taskId: string; slot: SlotProposal | null };

async function buildRecurrence(input: TaskInput, tz: string) {
  if (!input.recurrence) return null;
  const r = input.recurrence;
  const rule = await prisma.recurrenceRule.create({
    data: {
      frequency: r.frequency,
      interval: r.interval,
      byWeekday: r.byWeekday,
      trigger: r.trigger,
      endDate: r.endDate ? parseDateKey(r.endDate, tz) : null,
    },
  });
  return rule;
}

export async function createTask(raw: unknown): Promise<ActionResult<CreateResult>> {
  return wrap(async () => {
    const user = await requireUser();
    if (user.role === "HR" || user.role === "CA") throw new ForbiddenError();
    const input = taskInputSchema.parse(raw);
    const assignees = await validateAssignees(user, input.assigneeIds, input.type);
    const settings = await getSettings();
    const selfAssigned = input.assigneeIds.length === 1 && input.assigneeIds[0] === user.id;

    let start = input.scheduledStart ? new Date(input.scheduledStart) : null;
    let end = input.scheduledEnd ? new Date(input.scheduledEnd) : null;
    let slot: SlotProposal | null = null;
    if (start && !end) end = new Date(start.getTime() + input.allocatedMinutes * 60000);
    if (!start) {
      slot = await proposeSlot(input.assigneeIds, input.allocatedMinutes, { requesterRole: user.role, requesterId: user.id });
      if (!slot) throw new Error("No available slot found in the next 60 days");
      start = slot.start;
      end = slot.end;
    }
    const rule = await buildRecurrence(input, settings.timezone);
    if (rule) await prisma.recurrenceRule.update({ where: { id: rule.id }, data: { nextRunAt: nextRunAt(rule, start!, settings.timezone) } });

    const task = await prisma.task.create({
      data: {
        title: input.title,
        description: sanitizeDescription(input.description),
        type: input.type,
        clientId: input.clientId,
        createdById: user.id,
        assignedById: user.id,
        allocatedMinutes: input.allocatedMinutes,
        scheduledStart: start,
        scheduledEnd: end,
        important: input.important,
        priority: input.priority,
        selfAssigned,
        protected: selfAssigned && user.role === "ADMIN",
        recurrenceRuleId: rule?.id,
        status: "ASSIGNED",
        assignees: { create: input.assigneeIds.map((userId) => ({ userId })) },
        teams: { create: input.teamIds.map((teamId) => ({ teamId })) },
        tags: { create: input.tagIds.map((workTypeId) => ({ workTypeId })) },
      },
    });
    await prisma.client.update({ where: { id: input.clientId }, data: { visibleInFilters: true } });
    await audit(user.id, "task.create", "Task", task.id, null, task);
    await queueTaskCreation(task.id, input.type);
    if (slot?.displaced.length) await shiftDisplacedTasks(slot.displaced, user.id);

    const leaders = assignees.map((a) => a.teamLeaderId).filter((x): x is string => !!x && x !== user.id);
    await notify({
      userIds: [...input.assigneeIds.filter((id) => id !== user.id), ...leaders],
      kind: "TASK_ASSIGNED",
      title: `${input.type === "MEETING" ? "Meeting" : "Task"} assigned: ${input.title}`,
      body: `by ${user.name ?? "someone"}`,
      href: `/dashboard?task=${task.id}`,
      taskId: task.id,
      chat: false,
    });
    void publishTaskChanged(task.id);
    safeRevalidate("/dashboard");
    // Process the integration queue promptly (best-effort; the job runner also drains it).
    void import("@/google/queue").then((q) => q.processPending()).catch(() => undefined);
    return { taskId: task.id, slot };
  });
}

/** Preview the next available slot before saving (SPEC §9.2 step 5). */
export async function previewSlot(assigneeIds: string[], allocatedMinutes: number): Promise<ActionResult<SlotProposal | null>> {
  return wrap(async () => {
    const user = await requireUser();
    if (user.role === "HR" || user.role === "CA") throw new ForbiddenError();
    const ids = idsSchema.parse(assigneeIds);
    if (!ids.length) return null;
    await validateAssignees(user, ids, "WORK"); // only people this user may assign to
    const minutes = z.number().int().min(5).max(24 * 60 * 30).parse(allocatedMinutes);
    return proposeSlot(ids, minutes, { requesterRole: user.role, requesterId: user.id });
  });
}

/** Live "Today / Tom / Week / Month – X Hours – N" figures for the add-task header (SPEC §6). */
export async function periodLoads(assigneeIds: string[]): Promise<ActionResult<Record<string, { minutes: number; count: number }>>> {
  return wrap(async () => {
    const user = await requireUser();
    if (user.role === "HR" || user.role === "CA") throw new ForbiddenError();
    const requested = idsSchema.parse(assigneeIds);
    if (requested.length) await validateAssignees(user, requested, "WORK");
    const { periodLoad } = await import("@/server/tasks/queries");
    const { zonedStartOfDay } = await import("@/lib/time");
    const { addDays, addMonths } = await import("date-fns");
    const tz = (await getSettings()).timezone;
    const ids = requested.length ? requested : [user.id];
    const today = zonedStartOfDay(new Date(), tz);
    const [t, tom, week, month] = await Promise.all([
      periodLoad(ids, today, addDays(today, 1)),
      periodLoad(ids, addDays(today, 1), addDays(today, 2)),
      periodLoad(ids, today, addDays(today, 7)),
      periodLoad(ids, today, addMonths(today, 1)),
    ]);
    return { today: t, tomorrow: tom, week, month };
  });
}

/**
 * Add-task header (design): remaining inventory (capacity − assigned) and the number of tasks already assigned
 * for Today / Tom / Week / month. Scope = the selected assignees, or the caller's whole visible team when none
 * are selected (Admin: everyone; Team Leader: own executives + self; Executive: self).
 */
export async function addTaskInventory(assigneeIds: string[]): Promise<ActionResult<Record<string, { minutes: number; count: number }>>> {
  return wrap(async () => {
    const user = await requireUser();
    if (user.role === "HR" || user.role === "CA") throw new ForbiddenError();
    const requested = idsSchema.parse(assigneeIds);
    if (requested.length) await validateAssignees(user, requested, "WORK");
    let scope: string[] = requested;
    if (!scope.length) {
      if (user.role === "ADMIN") {
        scope = (await prisma.user.findMany({ where: { active: true, role: { in: ["ADMIN", "TEAM_LEADER", "EXECUTIVE"] } }, select: { id: true } })).map((u) => u.id);
      } else if (user.role === "TEAM_LEADER") {
        scope = [user.id, ...(await prisma.user.findMany({ where: { active: true, teamLeaderId: user.id }, select: { id: true } })).map((u) => u.id)];
      } else {
        scope = [user.id];
      }
    }
    const { inventoryFor } = await import("@/server/inventory/queries");
    const { zonedStartOfDay, dateKey } = await import("@/lib/time");
    const { addDays, addMonths } = await import("date-fns");
    const tz = (await getSettings()).timezone;
    const today = zonedStartOfDay(new Date(), tz);
    const monthEnd = addDays(addMonths(today, 1), -1);
    const key = (d: Date) => dateKey(d, tz);
    const periods: Record<string, { fromKey: string; toKey: string }> = {
      today: { fromKey: key(today), toKey: key(today) },
      tomorrow: { fromKey: key(addDays(today, 1)), toKey: key(addDays(today, 1)) },
      week: { fromKey: key(today), toKey: key(addDays(today, 6)) },
      month: { fromKey: key(today), toKey: key(monthEnd) },
    };
    // One inventory pass over the month; periods are derived from the per-user per-day rows.
    const scopeSet = new Set(scope);
    const inv = await inventoryFor({ from: today, to: monthEnd });
    const rows = inv.rows.filter((r) => scopeSet.has(r.userId));
    const tasks = await prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { in: ACTIVE_STATUSES },
        assignees: { some: { userId: { in: scope } } },
        scheduledStart: { gte: today, lt: addDays(monthEnd, 1) },
      },
      select: { scheduledStart: true },
    });
    const out: Record<string, { minutes: number; count: number }> = {};
    for (const [name, p] of Object.entries(periods)) {
      const inRange = (k: string) => k >= p.fromKey && k <= p.toKey;
      out[name] = {
        minutes: rows.filter((r) => inRange(r.date)).reduce((sum, r) => sum + r.sellableMinutes, 0),
        count: tasks.filter((t) => t.scheduledStart && inRange(key(t.scheduledStart))).length,
      };
    }
    return out;
  });
}
