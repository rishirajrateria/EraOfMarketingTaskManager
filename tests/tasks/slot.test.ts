import { beforeEach, describe, expect, it } from "vitest";
import { addDays, nextTuesday } from "date-fns";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { dateKey, zonedDayAt, zonedStartOfDay } from "@/lib/time";

const session = mockSession();
const TZ = "Asia/Kolkata";

/** Next Tuesday (strictly after today) at 10:00 IST, plus its yyyy-MM-dd key. */
function nextTue() {
  const day = nextTuesday(new Date());
  return { start: zonedDayAt(day, 600, TZ), end: zonedDayAt(day, 660, TZ), key: dateKey(zonedDayAt(day, 600, TZ), TZ), day };
}

async function rawTask(o: { clientId: string; createdById: string; assigneeIds: string[]; start: Date; end: Date; selfAssigned?: boolean; protected?: boolean; title?: string; status?: "ASSIGNED" | "COMPLETED" }) {
  return testDb.task.create({
    data: {
      title: o.title ?? "raw",
      clientId: o.clientId,
      createdById: o.createdById,
      assignedById: o.createdById,
      allocatedMinutes: Math.round((o.end.getTime() - o.start.getTime()) / 60000),
      scheduledStart: o.start,
      scheduledEnd: o.end,
      selfAssigned: o.selfAssigned ?? false,
      protected: o.protected ?? false,
      status: o.status ?? "ASSIGNED",
      assignees: { create: o.assigneeIds.map((userId) => ({ userId })) },
    },
  });
}

describe("scheduling/slot", () => {
  beforeEach(async () => {
    await resetDb();
  });

  describe("busyFor", () => {
    it("classifies an Executive's self-assigned task as soft for superiors and hard for peers", async () => {
      const { admin, tl, exec, client } = await seedBasics();
      const { start, end } = nextTue();
      const t = await rawTask({ clientId: client.id, createdById: exec.id, assigneeIds: [exec.id], start, end, selfAssigned: true });
      const { busyFor } = await import("@/server/scheduling/slot");
      const from = new Date();
      const to = addDays(from, 60);

      const asAdmin = await busyFor(exec.id, from, to, { requesterRole: "ADMIN", requesterId: admin.id });
      expect(asAdmin.hard).toEqual([]);
      expect(asAdmin.soft).toEqual([{ id: t.id, start, end }]);

      const asOwnTl = await busyFor(exec.id, from, to, { requesterRole: "TEAM_LEADER", requesterId: tl.id });
      expect(asOwnTl.soft.map((s) => s.id)).toEqual([t.id]);
      expect(asOwnTl.hard).toEqual([]);

      const otherTl = await testDb.user.create({ data: { email: "tl2@test.local", name: "TL2", role: "TEAM_LEADER", activatedAt: new Date() } });
      const asOtherTl = await busyFor(exec.id, from, to, { requesterRole: "TEAM_LEADER", requesterId: otherTl.id });
      expect(asOtherTl.soft).toEqual([]);
      expect(asOtherTl.hard).toEqual([{ start, end }]);

      const asExec = await busyFor(exec.id, from, to, { requesterRole: "EXECUTIVE", requesterId: exec.id });
      expect(asExec.soft).toEqual([]);
      expect(asExec.hard).toEqual([{ start, end }]);
    });

    it("Admin's own self-assigned task and protected tasks are always hard; assigned tasks are hard", async () => {
      const { admin, tl, exec, client } = await seedBasics();
      const { start, end } = nextTue();
      const { busyFor } = await import("@/server/scheduling/slot");
      const from = new Date();
      const to = addDays(from, 60);

      await rawTask({ clientId: client.id, createdById: admin.id, assigneeIds: [admin.id], start, end, selfAssigned: true, protected: true });
      const admin2 = await testDb.user.create({ data: { email: "admin2@test.local", name: "Admin2", role: "ADMIN", activatedAt: new Date() } });
      const adminOwn = await busyFor(admin.id, from, to, { requesterRole: "ADMIN", requesterId: admin2.id });
      expect(adminOwn.soft).toEqual([]);
      expect(adminOwn.hard).toEqual([{ start, end }]);

      const prot = await rawTask({ clientId: client.id, createdById: exec.id, assigneeIds: [exec.id], start, end, selfAssigned: true, protected: true });
      const protectedExec = await busyFor(exec.id, from, to, { requesterRole: "ADMIN", requesterId: admin.id });
      expect(protectedExec.soft).toEqual([]);
      expect(protectedExec.hard).toEqual([{ start, end }]);
      await testDb.task.delete({ where: { id: prot.id } });

      // a task assigned by the TL (not self-assigned) is a hard block even for Admin
      await rawTask({ clientId: client.id, createdById: tl.id, assigneeIds: [exec.id], start, end });
      const assigned = await busyFor(exec.id, from, to, { requesterRole: "ADMIN", requesterId: admin.id });
      expect(assigned.soft).toEqual([]);
      expect(assigned.hard).toEqual([{ start, end }]);
    });

    it("ignores completed / deleted / out-of-window / excluded tasks", async () => {
      const { admin, exec, client } = await seedBasics();
      const { start, end } = nextTue();
      const { busyFor } = await import("@/server/scheduling/slot");
      const from = new Date();
      const to = addDays(from, 60);
      await rawTask({ clientId: client.id, createdById: exec.id, assigneeIds: [exec.id], start, end, status: "COMPLETED" });
      const del = await rawTask({ clientId: client.id, createdById: exec.id, assigneeIds: [exec.id], start, end });
      await testDb.task.update({ where: { id: del.id }, data: { deletedAt: new Date() } });
      await rawTask({ clientId: client.id, createdById: exec.id, assigneeIds: [exec.id], start: addDays(start, 90), end: addDays(end, 90) });
      const excluded = await rawTask({ clientId: client.id, createdById: exec.id, assigneeIds: [exec.id], start, end });
      const r = await busyFor(exec.id, from, to, { requesterRole: "EXECUTIVE", requesterId: exec.id, excludeTaskId: excluded.id });
      expect(r.hard).toEqual([]);
      expect(r.soft).toEqual([]);
    });
  });

  describe("proposeSlot", () => {
    it("a superior's task overlaps a subordinate's self-assigned block only when nothing else fits", async () => {
      const { admin, exec, client } = await seedBasics();
      const { start, end } = nextTue();
      const soft = await rawTask({ clientId: client.id, createdById: exec.id, assigneeIds: [exec.id], start, end, selfAssigned: true });
      const { proposeSlot } = await import("@/server/scheduling/slot");
      // plenty of room in the horizon → the soft block is honoured, nothing displaced
      const p = await proposeSlot([exec.id], 60, { requesterRole: "ADMIN", requesterId: admin.id, from: start, horizonDays: 3 });
      expect(p).not.toBeNull();
      expect(p!.displaced).toEqual([]);
      expect(p!.start.getTime()).toBeGreaterThanOrEqual(end.getTime());
      // horizon squeezed to that single hour → the soft block is displaced
      const big = await proposeSlot([exec.id], 60, { requesterRole: "ADMIN", requesterId: admin.id, from: start, horizonDays: 1 });
      // one working day still has 7 more free hours, so a 60-min task fits without displacing
      expect(big!.displaced).toEqual([]);
      const full = await proposeSlot([exec.id], 480, { requesterRole: "ADMIN", requesterId: admin.id, from: start, horizonDays: 1 });
      expect(full).not.toBeNull();
      expect(full!.displaced).toEqual([soft.id]);
      expect(full!.start.getTime()).toBe(start.getTime());
    });
  });

  describe("leave handling", () => {
    it("tasksAffectedByLeave finds overlapping tasks and shiftTasksForLeave moves them out of the leave window", async () => {
      const { admin, tl, exec, client } = await seedBasics();
      const { start, end, key, day } = nextTue();
      const task = await rawTask({ clientId: client.id, createdById: tl.id, assigneeIds: [exec.id], start, end, title: "On leave day" });
      // an unrelated task on another day for the same user must not be touched
      const other = await rawTask({ clientId: client.id, createdById: tl.id, assigneeIds: [exec.id], start: addDays(start, 1), end: addDays(end, 1), title: "Other day" });
      const dateOnly = new Date(`${key}T00:00:00Z`);
      const leave = await testDb.leave.create({ data: { userId: exec.id, from: dateOnly, to: dateOnly, status: "ADMIN_APPROVED", reason: "sick" } });

      const { tasksAffectedByLeave, shiftTasksForLeave } = await import("@/server/scheduling/shift");
      const affected = await tasksAffectedByLeave(leave.id);
      expect(affected.map((a) => a.id)).toEqual([task.id]);

      const r = await shiftTasksForLeave(leave.id, admin.id);
      expect(r.shifted).toBe(1);
      const moved = await testDb.task.findUniqueOrThrow({ where: { id: task.id } });
      expect(moved.scheduledStart!.getTime()).not.toBe(start.getTime());
      const dayStart = zonedStartOfDay(day, TZ);
      const dayEnd = addDays(dayStart, 1);
      const outside = moved.scheduledEnd!.getTime() <= dayStart.getTime() || moved.scheduledStart!.getTime() >= dayEnd.getTime();
      expect(outside).toBe(true);
      expect(dateKey(moved.scheduledStart!, TZ)).not.toBe(key);
      expect(moved.overdue).toBe(false);
      // it must not collide with the user's other task either
      const o = await testDb.task.findUniqueOrThrow({ where: { id: other.id } });
      expect(o.scheduledStart!.getTime()).toBe(addDays(start, 1).getTime());
      expect(moved.scheduledEnd!.getTime() <= o.scheduledStart!.getTime() || moved.scheduledStart!.getTime() >= o.scheduledEnd!.getTime()).toBe(true);

      const notes = await testDb.notification.findMany({ where: { taskId: task.id, kind: "TASK_SHIFTED" } });
      expect(notes.map((n) => n.userId).sort()).toEqual([exec.id, tl.id].sort());
      expect((await testDb.leave.findUniqueOrThrow({ where: { id: leave.id } })).tasksShiftedAt).not.toBeNull();
      expect(await testDb.auditLog.count({ where: { entityId: task.id, action: "task.shift", actorId: admin.id } })).toBe(1);
      expect(await testDb.integrationJob.count({ where: { taskId: task.id, kind: "CALENDAR_UPDATE" } })).toBe(1);

      expect(await tasksAffectedByLeave(leave.id)).toEqual([]);
    });

    it("only approved leaves make days unavailable to proposeSlot", async () => {
      const { admin, exec, client } = await seedBasics();
      const { key, day } = nextTue();
      const dateOnly = new Date(`${key}T00:00:00Z`);
      const { proposeSlot, leaveDayKeys } = await import("@/server/scheduling/slot");
      const from = zonedStartOfDay(day, TZ);
      const pending = await testDb.leave.create({ data: { userId: exec.id, from: dateOnly, to: dateOnly, status: "REQUESTED" } });
      expect(await leaveDayKeys(exec.id, from, addDays(from, 7), TZ)).toEqual(new Set());
      let p = await proposeSlot([exec.id], 60, { requesterRole: "ADMIN", requesterId: admin.id, from });
      expect(dateKey(p!.start, TZ)).toBe(key);

      await testDb.leave.update({ where: { id: pending.id }, data: { status: "HR_APPROVED" } });
      expect(await leaveDayKeys(exec.id, from, addDays(from, 7), TZ)).toEqual(new Set([key]));
      p = await proposeSlot([exec.id], 60, { requesterRole: "ADMIN", requesterId: admin.id, from });
      expect(dateKey(p!.start, TZ)).not.toBe(key);
      expect(p!.start.getTime()).toBeGreaterThan(from.getTime());
      void client;
    });
  });
});
