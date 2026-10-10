"use server";
import { prisma } from "@/lib/db";
import { requireUser, type SessionUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { notify, publishTaskChanged } from "@/lib/notify";
import { safeRevalidate } from "@/lib/revalidate";
import { dateKey, zonedEndOfDay, zonedStartOfDay } from "@/lib/time";
import { getSettings } from "@/lib/settings";
import { proposeSlot, shiftDisplacedTasks, type SlotProposal } from "@/server/scheduling/slot";
import { queueTaskCreation } from "@/google/task-integrations";
import { taskInputSchema, type TaskInput } from "@/server/tasks/schema";
import { firstName, planAssignment, type AssignmentPlan } from "@/server/tasks/assignment";
import { nextRunAt, repeatRuleData } from "@/server/tasks/recurrence";
import { completeRule } from "@/server/tasks/repeat-rule";
import { ACTIVE_STATUSES } from "@/server/tasks/state";
import { sanitizeDescription } from "@/lib/sanitize";
import { clientGuestEmails, normaliseEmails } from "@/server/tasks/meeting";
import { z } from "zod";

const idsSchema = z.array(z.string().min(1)).max(50);

/** Assignment rules (SPEC §2): Admin→Team Leaders (or self), TL→own team's Executives (or self), Exec→self only. */
export async function validateAssignees(user: SessionUser, assigneeIds: string[], type: "WORK" | "MEETING") {
  const users = await prisma.user.findMany({ where: { id: { in: assigneeIds }, active: true }, select: { id: true, role: true, teamId: true, teamLeaderId: true, email: true } });
  if (users.length !== assigneeIds.length) throw new Error("Unknown or inactive assignee");
  for (const a of users) {
    if (a.id === user.id) continue;
    if (type === "MEETING") continue; // anyone with a dashboard may invite anyone to a meeting
    if (user.role === "ADMIN") {
      if (a.role === "TEAM_LEADER" || a.role === "ADMIN") continue;
      throw new ForbiddenError("Admin assigns Executives only via their Team Leader");
    }
    if (user.role === "TEAM_LEADER") {
      if (a.role === "EXECUTIVE" && (a.teamLeaderId === user.id || (!!user.teamId && a.teamId === user.teamId))) continue;
      throw new ForbiddenError("Team Leaders may only assign their own Executives");
    }
    throw new ForbiddenError("Executives may only self-assign");
  }
  return users;
}

/** "Invite the client" (ADR 0017): the client's own addresses are added here, never sent to a non-Admin browser. */
async function withClientGuests(clientId: string, typed: string[]): Promise<string[]> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { email: true, contact: true } });
  return normaliseEmails([...clientGuestEmails(client), ...typed]);
}

export type CreateResult = { taskId: string; slot: SlotProposal | null };

/**
 * Admin → the Team Leader(s): "New task from Rishi: <title> · prefers Arjun — assign it from the task" (ADR 0008).
 * Everyone else: the assignees and their Team Leaders hear "Task assigned: <title>".
 */
async function notifyNewTask(
  user: SessionUser,
  taskId: string,
  title: string,
  type: "WORK" | "MEETING",
  plan: AssignmentPlan,
  assignees: { id: string; teamLeaderId: string | null }[],
) {
  const others = plan.assigneeIds.filter((id) => id !== user.id);
  const href = `/dashboard?task=${taskId}`;
  if (user.role === "ADMIN") {
    const prefs = plan.preferredAssigneeIds.length
      ? await prisma.user.findMany({ where: { id: { in: plan.preferredAssigneeIds } }, select: { id: true, name: true } })
      : [];
    const names = plan.preferredAssigneeIds.map((id) => firstName(prefs.find((p) => p.id === id)?.name)).join(", ");
    const kind = type === "MEETING" ? "meeting" : "task";
    const suffix = names ? ` · prefers ${names} — assign it from the task` : "";
    await notify({ userIds: others, kind: "TASK_ASSIGNED", title: `New ${kind} from ${firstName(user.name)}${suffix}`, href, taskId, chat: false });
    return;
  }
  const leaders = assignees.map((a) => a.teamLeaderId).filter((x): x is string => !!x && x !== user.id);
  await notify({
    userIds: [...others, ...leaders],
    kind: "TASK_ASSIGNED",
    title: `New ${type === "MEETING" ? "meeting" : "task"} from ${firstName(user.name)}`,
    href,
    taskId,
    chat: false,
  });
}

/** Stores the repeat rule anchored on the first occurrence's day; `nextRunAt` = due time of the second one. */
async function buildRecurrence(input: TaskInput, start: Date, tz: string) {
  if (!input.recurrence) return null;
  const { trigger, ...r } = input.recurrence;
  const anchor = dateKey(start, tz);
  const rule = completeRule({ ...r, anchor }, anchor);
  const data = repeatRuleData(rule, tz);
  return prisma.recurrenceRule.create({ data: { ...data, trigger, nextRunAt: nextRunAt(data, start, tz, 1) } });
}

export async function createTask(raw: unknown): Promise<ActionResult<CreateResult>> {
  return wrap(async () => {
    const user = await requireUser();
    if (user.role === "HR" || user.role === "CA") throw new ForbiddenError();
    const input = taskInputSchema.parse(raw);
    if (input.type === "MEETING" && input.inviteClient) input.guestEmails = await withClientGuests(input.clientId, input.guestEmails);
    const plan = await planAssignment(user, input, (ids, type) => validateAssignees(user, ids, type));
    const assignees = await prisma.user.findMany({ where: { id: { in: plan.assigneeIds } }, select: { id: true, teamLeaderId: true } });
    const settings = await getSettings();
    const selfAssigned = plan.assigneeIds.length === 1 && plan.assigneeIds[0] === user.id;

    const meeting = input.type === "MEETING";
    // Meetings (ADR 0012): options default to the company time zone; all-day meetings cover whole days in that zone.
    const meetingOptions = meeting && input.meetingOptions ? { ...input.meetingOptions, timeZone: input.meetingOptions.timeZone || settings.timezone } : null;
    let start = input.scheduledStart ? new Date(input.scheduledStart) : null;
    let end = input.scheduledEnd ? new Date(input.scheduledEnd) : null;
    if (meetingOptions?.allDay) {
      const zone = meetingOptions.timeZone;
      start = zonedStartOfDay(start ?? new Date(), zone);
      end = zonedEndOfDay(end && end > start ? new Date(end.getTime() - 1) : start, zone);
    }
    let slot: SlotProposal | null = null;
    if (start && !end) end = new Date(start.getTime() + input.allocatedMinutes * 60000);
    if (!start) {
      slot = await proposeSlot(plan.assigneeIds, input.allocatedMinutes, { requesterRole: user.role, requesterId: user.id });
      if (!slot) throw new Error("No available slot found in the next 60 days");
      start = slot.start;
      end = slot.end;
    }
    const rule = await buildRecurrence(input, start!, settings.timezone);

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
        preferredAssigneeIds: plan.preferredAssigneeIds,
        guestEmails: meeting ? input.guestEmails : [],
        ...(meetingOptions ? { meetingOptions } : {}),
        assignees: { create: plan.assigneeIds.map((userId) => ({ userId })) },
        teams: { create: plan.teamIds.map((teamId) => ({ teamId })) },
        tags: { create: plan.tagIds.map((workTypeId) => ({ workTypeId })) },
      },
    });
    await prisma.client.update({ where: { id: input.clientId }, data: { visibleInFilters: true } });
    await audit(user.id, "task.create", "Task", task.id, null, task);
    await queueTaskCreation(task.id, input.type);
    if (slot?.displaced.length) await shiftDisplacedTasks(slot.displaced, user.id);

    await notifyNewTask(user, task.id, input.title, input.type, plan, assignees);
    void publishTaskChanged(task.id);
    safeRevalidate("/dashboard");
    // Process the integration queue promptly (best-effort; the job runner also drains it).
    void import("@/google/queue").then((q) => q.processPending()).catch(() => undefined);
    return { taskId: task.id, slot };
  });
}

/** Preview the next available slot before saving (SPEC §9.2 step 5). */
export async function previewSlot(assigneeIds: string[], allocatedMinutes: number, type: "WORK" | "MEETING" = "WORK"): Promise<ActionResult<SlotProposal | null>> {
  return wrap(async () => {
    const user = await requireUser();
    if (user.role === "HR" || user.role === "CA") throw new ForbiddenError();
    const ids = idsSchema.parse(assigneeIds);
    if (!ids.length) return null;
    await validateAssignees(user, ids, type === "MEETING" ? "MEETING" : "WORK"); // only people this user may assign / invite
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

const teamIdsSchema = z.array(z.string().min(1).max(64)).min(1, "Pick a team").max(20);

export type TeamPeriodLoad = { leftMinutes: number; bookedMinutes: number; count: number };

/**
 * Add-task header (owner's revision): capacity of the selected team(s) — all active members (Team Leader +
 * executives) — for Today / Tom / Week / Month: minutes BOOKED (scheduled minutes of open tasks, per person, as in
 * the inventory screen), minutes LEFT (inventory: capacity − booked) and the number of tasks booked. Admin may look
 * at any active team; Team Leaders and Executives only at their own team.
 */
export async function addTaskInventory(teamIds: string[]): Promise<ActionResult<Record<"today" | "tomorrow" | "week" | "month", TeamPeriodLoad>>> {
  return wrap(async () => {
    const user = await requireUser();
    if (user.role !== "ADMIN" && user.role !== "TEAM_LEADER" && user.role !== "EXECUTIVE") throw new ForbiddenError();
    const ids = Array.from(new Set(teamIdsSchema.parse(teamIds)));
    if (user.role !== "ADMIN" && (!user.teamId || ids.some((id) => id !== user.teamId))) throw new ForbiddenError("You can only see your own team's capacity");
    const teams = await prisma.team.count({ where: { id: { in: ids }, active: true } });
    if (teams !== ids.length) throw new Error("Unknown or inactive team");
    const { teamMemberIds } = await import("@/server/tasks/assignment");
    const scope = new Set(await teamMemberIds(ids));

    const { inventoryFor } = await import("@/server/inventory/queries");
    const { zonedStartOfDay } = await import("@/lib/time");
    const { addDays, addMonths } = await import("date-fns");
    const tz = (await getSettings()).timezone;
    const today = zonedStartOfDay(new Date(), tz);
    const monthEnd = addDays(addMonths(today, 1), -1);
    const key = (d: Date) => dateKey(d, tz);
    const periods = {
      today: { fromKey: key(today), toKey: key(today) },
      tomorrow: { fromKey: key(addDays(today, 1)), toKey: key(addDays(today, 1)) },
      week: { fromKey: key(today), toKey: key(addDays(today, 6)) },
      month: { fromKey: key(today), toKey: key(monthEnd) },
    };
    // One inventory pass over the month; periods are derived from the per-user per-day rows.
    const inv = await inventoryFor({ from: today, to: monthEnd });
    const rows = inv.rows.filter((r) => scope.has(r.userId));
    const tasks = scope.size
      ? await prisma.task.findMany({
          where: { deletedAt: null, status: { in: ACTIVE_STATUSES }, assignees: { some: { userId: { in: [...scope] } } }, scheduledStart: { gte: today, lt: addDays(monthEnd, 1) } },
          select: { scheduledStart: true },
        })
      : [];
    const out = {} as Record<keyof typeof periods, TeamPeriodLoad>;
    for (const [name, p] of Object.entries(periods) as [keyof typeof periods, (typeof periods)["today"]][]) {
      const inRange = (k: string) => k >= p.fromKey && k <= p.toKey;
      const inPeriod = rows.filter((r) => inRange(r.date));
      out[name] = {
        leftMinutes: inPeriod.reduce((sum, r) => sum + r.sellableMinutes, 0),
        bookedMinutes: inPeriod.reduce((sum, r) => sum + r.assignedMinutes, 0),
        count: tasks.filter((t) => t.scheduledStart && inRange(key(t.scheduledStart))).length,
      };
    }
    return out;
  });
}
