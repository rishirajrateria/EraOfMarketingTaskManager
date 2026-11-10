/**
 * Team Leader task proposals (ADR 0021). Plain module (no "use server"): shared by createTask and the proposal actions.
 *
 * A Team Leader's WORK task is stored as PENDING_APPROVAL: no assignee, no scheduled time, no Google items and nothing
 * booked. It carries the TL's preferred slot (`requestedDate` / `requestedTime`) and an open TASK_PROPOSAL request in
 * Admin's inbox. Approval turns it into an ordinary ASSIGNED task for that TL, placed at the requested time when that is
 * still free, else at the next free slot (the existing slot finder, which reads `personDayStatus`).
 */
import type { Prisma } from "@prisma/client";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { ForbiddenError, type SessionUser } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { adminIds, notify } from "@/lib/notify";
import { bus } from "@/lib/events";
import { dateKey } from "@/lib/time";
import { getSettings } from "@/lib/settings";
import { taskDeepLink } from "@/lib/notification-kinds";
import { proposedPhrase } from "@/lib/notification-text";
import { sanitizeDescription } from "@/lib/sanitize";
import { isDateOnly, type TaskInput } from "@/server/tasks/schema";
import { deadlineDay, deadlineFields } from "@/server/tasks/deadline";
import { workTypeIdsForTeams, MSG } from "@/server/tasks/assignment";
import { proposeSlot, type SlotProposal } from "@/server/scheduling/slot";
import { proposeSlotOnDay } from "@/server/scheduling/day-slot";

export const PENDING = "PENDING_APPROVAL" as const;
export const MSG_PROPOSAL = {
  noExecutives: "A proposal goes to Admin first — assign an executive after it is approved",
  pending: "This task is waiting for Admin's approval",
  noTeam: "You are not in a team yet — ask Admin to add you to one",
  execWork: "Executives book meetings only — ask your Team Leader for a task",
  notPending: "This proposal was already decided",
} as const;

/** Is this a proposal? (pending tasks hold no time, book nothing and get no Google items). */
export const isPending = (t: { status: string }) => t.status === PENDING;

/** Throws for a pending proposal: start, finish, assign, Drive, uploads… all wait for Admin. */
export function assertNotPending(t: { status: string }) {
  if (isPending(t)) throw new Error(MSG_PROPOSAL.pending);
}

export type RequestedSlot = { requestedDate: string | null; requestedTime: string | null };

/** The TL's preferred slot from the add-task input: a deadline day, a day, a day + time, or none ("Up next"). */
export function requestedSlotOf(input: Pick<TaskInput, "scheduledStart" | "deadlineOnly">, tz: string, now = new Date()): RequestedSlot {
  const s = input.scheduledStart;
  if (input.deadlineOnly) return { requestedDate: deadlineDay(s, tz, now), requestedTime: null };
  if (!s) return { requestedDate: null, requestedTime: null };
  if (isDateOnly(s)) return { requestedDate: s, requestedTime: null };
  const d = new Date(s);
  return { requestedDate: dateKey(d, tz), requestedTime: formatInTimeZone(d, tz, "HH:mm") };
}

/** Creates the pending proposal + its TASK_PROPOSAL request, and tells the Admins. */
export async function createProposal(user: SessionUser, input: TaskInput): Promise<string> {
  if (user.role !== "TEAM_LEADER") throw new ForbiddenError();
  if (!user.teamId) throw new Error(MSG_PROPOSAL.noTeam);
  if (input.assigneeIds.some((id) => id !== user.id)) throw new ForbiddenError(MSG_PROPOSAL.noExecutives);
  if (input.preferredAssigneeIds.length) throw new ForbiddenError("Only Admin sets preferred executives");
  const tagIds = Array.from(new Set(input.tagIds));
  const allowed = new Set(await workTypeIdsForTeams([user.teamId]));
  if (!tagIds.length || !tagIds.every((id) => allowed.has(id))) throw new Error(MSG.pickWork);
  const tz = (await getSettings()).timezone;
  const slot = requestedSlotOf(input, tz);
  const now = new Date();
  const { task, request } = await prisma.$transaction(async (tx) => {
    const task = await tx.task.create({
      data: {
        title: input.title,
        description: sanitizeDescription(input.description),
        type: "WORK",
        clientId: input.clientId,
        createdById: user.id,
        allocatedMinutes: input.deadlineOnly ? 0 : input.allocatedMinutes,
        deadlineOnly: input.deadlineOnly,
        important: input.important,
        priority: input.priority,
        status: PENDING,
        proposedById: user.id,
        proposedAt: now,
        ...slot,
        ...(input.recurrence ? { requestedRecurrence: input.recurrence as unknown as Prisma.InputJsonValue } : {}),
        teams: { create: [{ teamId: user.teamId! }] },
        tags: { create: tagIds.map((workTypeId) => ({ workTypeId })) },
      },
    });
    const request = await tx.request.create({ data: { type: "TASK_PROPOSAL", taskId: task.id, raisedById: user.id, targetRole: "ADMIN", note: "" } });
    await tx.client.update({ where: { id: input.clientId }, data: { visibleInFilters: true } });
    return { task, request };
  });
  await audit(user.id, "task.propose", "Task", task.id, null, { ...task, requestId: request.id });
  await notify({ userIds: await adminIds(), exceptUserId: user.id, kind: "TASK_PROPOSED", title: proposedPhrase(user.name), href: taskDeepLink(task.id), taskId: task.id, chat: false });
  bus.publish({ type: "requests.changed" });
  return task.id;
}

export type Placement = { start: Date; end: Date; slot: SlotProposal | null; onRequested: boolean };

/** Is [start, start+minutes) still free for `ids` (one contiguous gap, nobody displaced)? */
async function freeAt(ids: string[], start: Date, minutes: number, approver: SessionUser, excludeTaskId: string): Promise<SlotProposal | null> {
  const s = await proposeSlot(ids, minutes, { requesterRole: approver.role, requesterId: approver.id, excludeTaskId, from: start, horizonDays: 1, allowSplit: false });
  return s && s.start.getTime() === start.getTime() && !s.displaced.length ? s : null;
}

/**
 * Where an approved proposal goes: a deadline → its due day (today when that day has passed); a requested day + time
 * still free → exactly there; a requested day (today or later) → the next free time from that day; else "Up next".
 */
export async function placeApproved(
  t: { id: string; allocatedMinutes: number; deadlineOnly: boolean },
  req: RequestedSlot,
  assigneeId: string,
  approver: SessionUser,
  now = new Date(),
): Promise<Placement> {
  const s = await getSettings();
  const tz = s.timezone;
  const today = dateKey(now, tz);
  if (t.deadlineOnly) {
    const day = req.requestedDate && req.requestedDate >= today ? req.requestedDate : today;
    const f = deadlineFields(day, tz, s.workEndMinutes);
    return { start: f.scheduledStart, end: f.scheduledEnd, slot: null, onRequested: day === req.requestedDate };
  }
  const ids = [assigneeId];
  const opts = { requesterRole: approver.role, requesterId: approver.id, excludeTaskId: t.id };
  if (req.requestedDate && req.requestedTime) {
    const start = fromZonedTime(`${req.requestedDate}T${req.requestedTime}:00`, tz);
    if (start >= now) {
      const hit = await freeAt(ids, start, t.allocatedMinutes, approver, t.id);
      if (hit) return { start: hit.start, end: hit.end, slot: hit, onRequested: true };
    }
  }
  if (req.requestedDate && req.requestedDate >= today) {
    const r = await proposeSlotOnDay(ids, t.allocatedMinutes, req.requestedDate, opts, now);
    if (r) return { start: r.slot.start, end: r.slot.end, slot: r.slot, onRequested: r.onRequestedDay && !req.requestedTime };
  }
  const slot = await proposeSlot(ids, t.allocatedMinutes, opts);
  if (!slot) throw new Error("No available slot found in the next 60 days");
  return { start: slot.start, end: slot.end, slot, onRequested: !req.requestedDate };
}
