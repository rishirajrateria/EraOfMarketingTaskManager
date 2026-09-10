"use server";
/**
 * Leave flow server actions (SPEC §11.5, §9.3, §2).
 * request → HR/Admin approve or reject → (approved) Admin shifts affected tasks;
 * changes to an already-approved leave go through an APPROVED_CHANGE request that only Admin resolves.
 */
import { addDays } from "date-fns";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { wrap, type ActionResult } from "@/lib/action-result";
import { bus } from "@/lib/events";
import { adminIds, hrIds, notify } from "@/lib/notify";
import { ForbiddenError, requireRole, requireUser } from "@/lib/rbac";
import { safeRevalidate } from "@/lib/revalidate";
import { getSettings } from "@/lib/settings";
import { parseDateKey } from "@/lib/time";
import { createEvent, deleteEvent, updateEvent } from "@/google/calendar";
import { fromDbDate, toDbDate } from "@/server/inventory/compute";
import { shiftTasksForLeave, tasksAffectedByLeave } from "@/server/scheduling/shift";
import { APPROVED_LEAVE, type LeaveChangePayload } from "@/server/leave/queries";

const LEAVE_PATHS = ["/leave", "/requests/leave", "/attendance", "/admin/inventory", "/dashboard", "/requests"];

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected yyyy-MM-dd");
const rangeSchema = z
  .object({ from: dateKeySchema, to: dateKeySchema, reason: z.string().max(1000).default("") })
  .refine((r) => r.from <= r.to, { message: "'from' must be on or before 'to'" });
export type LeaveRangeInput = z.input<typeof rangeSchema>;

const changeSchema = z.union([z.object({ cancel: z.literal(true) }), rangeSchema]);
export type LeaveChangeInput = z.input<typeof changeSchema>;

function fmtRange(from: string, to: string) {
  return from === to ? from : `${from} → ${to}`;
}

async function leaveOr404(leaveId: string) {
  const leave = await prisma.leave.findUnique({ where: { id: leaveId }, include: { user: { select: { id: true, name: true, email: true } } } });
  if (!leave) throw new Error("Leave not found");
  return leave;
}

/** Calendar block for an approved leave: all-day span [from, to+1) in the company timezone. */
async function createLeaveCalendarEvent(leave: { id: string; from: Date; to: Date; user: { name: string; email: string } }) {
  const s = await getSettings();
  try {
    const ev = await createEvent({
      summary: `Leave: ${leave.user.name}`,
      start: parseDateKey(fromDbDate(leave.from), s.timezone),
      end: addDays(parseDateKey(fromDbDate(leave.to), s.timezone), 1),
      attendees: [leave.user.email],
      withMeet: false,
      requestId: `leave-${leave.id}`,
    });
    return ev.eventId;
  } catch {
    return null; // calendar is best-effort; approval must not fail because of it
  }
}

export async function requestLeave(input: LeaveRangeInput): Promise<ActionResult<{ leaveId: string }>> {
  return wrap(async () => {
    const u = await requireUser();
    const data = rangeSchema.parse(input);
    const me = await prisma.user.findUnique({ where: { id: u.id }, select: { active: true, name: true } });
    if (!me?.active) throw new ForbiddenError("Inactive user");
    const leave = await prisma.$transaction(async (tx) => {
      const l = await tx.leave.create({ data: { userId: u.id, from: toDbDate(data.from), to: toDbDate(data.to), reason: data.reason } });
      await tx.request.create({ data: { type: "LEAVE", leaveId: l.id, raisedById: u.id, targetRole: "HR", note: data.reason } });
      await audit(u.id, "leave.request", "Leave", l.id, null, l, tx);
      return l;
    });
    await notify({
      userIds: await hrIds(),
      kind: "LEAVE_REQUESTED",
      title: `Leave requested — ${me.name}`,
      body: `${fmtRange(data.from, data.to)}${data.reason ? ": " + data.reason : ""}`,
      href: `/requests/leave?leaveId=${leave.id}`,
    });
    bus.publish({ type: "requests.changed" });
    bus.publish({ type: "leave.changed", userId: u.id });
    safeRevalidate(...LEAVE_PATHS);
    return { leaveId: leave.id };
  });
}

async function resolveLeaveRequest(tx: Prisma.TransactionClient, leaveId: string, actorId: string, status: "APPROVED" | "REJECTED", note?: string) {
  await tx.request.updateMany({
    where: { leaveId, type: "LEAVE", status: "OPEN" },
    data: { status, resolvedById: actorId, resolvedAt: new Date(), resolutionNote: note },
  });
}

export async function hrApprove(leaveId: string): Promise<ActionResult<{ status: string; affectedTasks: number }>> {
  return wrap(async () => {
    const actor = await requireRole("HR", "ADMIN");
    const leave = await leaveOr404(leaveId);
    if (leave.status !== "REQUESTED") throw new Error(`Leave is already ${leave.status}`);
    const status = actor.role === "ADMIN" ? "ADMIN_APPROVED" : "HR_APPROVED";
    const calendarEventId = await createLeaveCalendarEvent(leave);
    const updated = await prisma.$transaction(async (tx) => {
      const l = await tx.leave.update({
        where: { id: leaveId },
        data: { status, calendarEventId, ...(actor.role === "ADMIN" ? { adminApprovedById: actor.id } : { hrApprovedById: actor.id }) },
      });
      await resolveLeaveRequest(tx, leaveId, actor.id, "APPROVED");
      await audit(actor.id, "leave.approve", "Leave", leaveId, leave, l, tx);
      return l;
    });
    const range = fmtRange(fromDbDate(leave.from), fromDbDate(leave.to));
    await notify({ userIds: [leave.userId], kind: "LEAVE_APPROVED", title: "Leave approved", body: range, href: "/leave" });
    bus.publish({ type: "leave.changed", userId: leave.userId });
    bus.publish({ type: "requests.changed" });

    const affected = await tasksAffectedByLeave(leaveId);
    if (affected.length) {
      await notify({
        userIds: await adminIds(),
        kind: "GENERIC",
        title: `Leave approved — ${affected.length} ${affected.length === 1 ? "task needs" : "tasks need"} shifting`,
        body: `${leave.user.name}, ${range}`,
        href: `/requests/leave?leaveId=${leaveId}`,
      });
    }
    safeRevalidate(...LEAVE_PATHS);
    return { status: updated.status, affectedTasks: affected.length };
  });
}

export async function hrReject(leaveId: string, note = ""): Promise<ActionResult<{ status: string }>> {
  return wrap(async () => {
    const actor = await requireRole("HR", "ADMIN");
    const reason = z.string().max(1000).parse(note ?? "");
    const leave = await leaveOr404(leaveId);
    if (leave.status !== "REQUESTED") throw new Error(`Leave is already ${leave.status}`);
    const updated = await prisma.$transaction(async (tx) => {
      const l = await tx.leave.update({ where: { id: leaveId }, data: { status: "REJECTED", rejectedById: actor.id } });
      await resolveLeaveRequest(tx, leaveId, actor.id, "REJECTED", reason);
      await audit(actor.id, "leave.reject", "Leave", leaveId, leave, l, tx);
      return l;
    });
    await notify({
      userIds: [leave.userId],
      kind: "LEAVE_REJECTED",
      title: "Leave rejected",
      body: `${fmtRange(fromDbDate(leave.from), fromDbDate(leave.to))}${reason ? ": " + reason : ""}`,
      href: "/leave",
    });
    bus.publish({ type: "leave.changed", userId: leave.userId });
    bus.publish({ type: "requests.changed" });
    safeRevalidate(...LEAVE_PATHS);
    return { status: updated.status };
  });
}

/** One-tap "Shift all affected tasks to next available slot" (SPEC §9.3). Admin only. */
export async function shiftLeaveTasks(leaveId: string): Promise<ActionResult<{ shifted: number }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const leave = await leaveOr404(leaveId);
    if (!APPROVED_LEAVE.includes(leave.status)) throw new Error("Leave is not approved");
    const result = await shiftTasksForLeave(leaveId, actor.id);
    const after = await prisma.leave.update({ where: { id: leaveId }, data: { tasksShiftedAt: new Date() } });
    await audit(actor.id, "leave.shiftTasks", "Leave", leaveId, leave, { ...after, shifted: result.shifted });
    bus.publish({ type: "requests.changed" });
    safeRevalidate(...LEAVE_PATHS);
    return result;
  });
}

/** Edit or cancel an already-approved leave → APPROVED_CHANGE request for Admin (SPEC §2). */
export async function requestLeaveChange(leaveId: string, change: LeaveChangeInput): Promise<ActionResult<{ requestId: string }>> {
  return wrap(async () => {
    const u = await requireUser();
    const payload = changeSchema.parse(change);
    const leave = await leaveOr404(leaveId);
    if (leave.userId !== u.id && u.role !== "HR" && u.role !== "ADMIN") throw new ForbiddenError();
    if (!APPROVED_LEAVE.includes(leave.status)) throw new Error("Only approved leaves need a change request");
    const open = await prisma.request.findFirst({ where: { leaveId, type: "APPROVED_CHANGE", status: "OPEN" } });
    if (open) throw new Error("A change request is already pending");
    const note = "cancel" in payload ? "Cancel leave" : `Change to ${fmtRange(payload.from, payload.to)}`;
    const req = await prisma.request.create({
      data: { type: "APPROVED_CHANGE", leaveId, raisedById: u.id, targetRole: "ADMIN", note, payload: payload as Prisma.InputJsonValue },
    });
    await audit(u.id, "leave.requestChange", "Leave", leaveId, leave, payload);
    await notify({
      userIds: await adminIds(),
      kind: "GENERIC",
      title: `Approved leave change — ${leave.user.name}`,
      body: note,
      href: `/requests/leave?leaveId=${leaveId}`,
    });
    bus.publish({ type: "requests.changed" });
    safeRevalidate(...LEAVE_PATHS);
    return { requestId: req.id };
  });
}

/** Admin applies (or declines) a change to an approved leave. HR cannot (SPEC §2). */
export async function resolveLeaveChange(requestId: string, approve: boolean): Promise<ActionResult<{ status: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const req = await prisma.request.findUnique({ where: { id: requestId } });
    if (!req || req.type !== "APPROVED_CHANGE" || !req.leaveId) throw new Error("Change request not found");
    if (req.status !== "OPEN") throw new Error("Request already resolved");
    const leave = await leaveOr404(req.leaveId);
    const payload = req.payload as LeaveChangePayload;
    let after = leave;
    if (approve) {
      if ("cancel" in payload) {
        if (leave.calendarEventId) await deleteEvent(leave.calendarEventId).catch(() => undefined);
        after = { ...leave, ...(await prisma.leave.update({ where: { id: leave.id }, data: { status: "REJECTED", calendarEventId: null, rejectedById: actor.id } })) };
      } else {
        const s = await getSettings();
        if (leave.calendarEventId) {
          await updateEvent(leave.calendarEventId, {
            start: parseDateKey(payload.from, s.timezone),
            end: addDays(parseDateKey(payload.to, s.timezone), 1),
          }).catch(() => undefined);
        }
        after = {
          ...leave,
          ...(await prisma.leave.update({
            where: { id: leave.id },
            data: { from: toDbDate(payload.from), to: toDbDate(payload.to), reason: payload.reason ?? leave.reason, status: "ADMIN_APPROVED", adminApprovedById: actor.id, tasksShiftedAt: null },
          })),
        };
      }
    }
    const status = approve ? "APPROVED" : "REJECTED";
    await prisma.request.update({ where: { id: requestId }, data: { status, resolvedById: actor.id, resolvedAt: new Date() } });
    await audit(actor.id, `leave.change.${status.toLowerCase()}`, "Leave", leave.id, leave, after);
    await notify({
      userIds: [leave.userId],
      kind: approve ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
      title: approve ? "Leave change approved" : "Leave change rejected",
      body: req.note,
      href: "/leave",
    });
    bus.publish({ type: "leave.changed", userId: leave.userId });
    bus.publish({ type: "requests.changed" });
    safeRevalidate(...LEAVE_PATHS);
    return { status };
  });
}
