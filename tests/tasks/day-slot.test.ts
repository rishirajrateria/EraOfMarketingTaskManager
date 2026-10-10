import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { anyTeamWorkType, createTaskAs, loadTask, settle } from "./helpers";
import { dateKey, parseDateKey, zonedDayAt } from "@/lib/time";

/**
 * Date-only starts (ADR 0010 addendum): "2026-10-23" = the next free time on that day for the people the task lands
 * on, within working hours and after their existing tasks; a full day falls back to the next free slot and says so.
 */
const session = mockSession();
const TZ = "Asia/Kolkata";

/** The next calendar day (strictly after today, Asia/Kolkata) whose weekday is `weekday` (0 = Sun … 6 = Sat). */
function nextKey(weekday: number, after = new Date()): string {
  let d = addDays(parseDateKey(dateKey(after, TZ), TZ), 1);
  while (toZonedTime(d, TZ).getDay() !== weekday) d = addDays(d, 1);
  return dateKey(d, TZ);
}
const at = (key: string, hhmm: string) => zonedDayAt(parseDateKey(key, TZ), Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)), TZ);
const hhmm = (d: Date) => `${String(toZonedTime(d, TZ).getHours()).padStart(2, "0")}:${String(toZonedTime(d, TZ).getMinutes()).padStart(2, "0")}`;

async function busyBlock(o: { clientId: string; createdById: string; assigneeIds: string[]; start: Date; end: Date; selfAssigned?: boolean }) {
  return testDb.task.create({
    data: {
      title: "busy",
      clientId: o.clientId,
      createdById: o.createdById,
      assignedById: o.createdById,
      allocatedMinutes: Math.round((o.end.getTime() - o.start.getTime()) / 60000),
      scheduledStart: o.start,
      scheduledEnd: o.end,
      selfAssigned: o.selfAssigned ?? false,
      status: "ASSIGNED",
      assignees: { create: o.assigneeIds.map((userId) => ({ userId })) },
    },
  });
}

describe("proposeSlotOnDay", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("puts the task at the working start of a free day, in the company time zone", async () => {
    const { admin, tl } = await seedBasics();
    const day = nextKey(2); // Tuesday
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    const r = await proposeSlotOnDay([tl.id], 60, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(r).not.toBeNull();
    expect(r!.onRequestedDay).toBe(true);
    expect(r!.requestedDay).toBe(day);
    expect(r!.requestedDayOff).toBe(false);
    expect(dateKey(r!.slot.start, TZ)).toBe(day);
    expect(hhmm(r!.slot.start)).toBe("10:00");
    expect(hhmm(r!.slot.end)).toBe("11:00");
    expect(r!.slot.displaced).toEqual([]);
  });

  it("skips the assignees' existing tasks that day (intersection of everyone's free time)", async () => {
    const { admin, tl, exec, client } = await seedBasics();
    const day = nextKey(2);
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [tl.id], start: at(day, "10:00"), end: at(day, "12:00") });
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [exec.id], start: at(day, "12:00"), end: at(day, "12:30") });
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    const one = await proposeSlotOnDay([tl.id], 60, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(hhmm(one!.slot.start)).toBe("12:00");
    expect(one!.onRequestedDay).toBe(true);
    const both = await proposeSlotOnDay([tl.id, exec.id], 60, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(hhmm(both!.slot.start)).toBe("12:30");
    expect(dateKey(both!.slot.start, TZ)).toBe(day);
  });

  it("takes the first gap where the whole task fits (no split around a busy block), like the prototype's dayFreeSlot", async () => {
    const { admin, tl, client } = await seedBasics();
    const day = nextKey(2);
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [tl.id], start: at(day, "11:00"), end: at(day, "15:00") });
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    // 10:00–11:00 is only an hour: a 2h task goes to 15:00–17:00, not 10:00 + 15:00
    const r = await proposeSlotOnDay([tl.id], 120, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(r!.onRequestedDay).toBe(true);
    expect(hhmm(r!.slot.start)).toBe("15:00");
    expect(hhmm(r!.slot.end)).toBe("17:00");
    expect(r!.slot.chunks).toHaveLength(1);
    // a 1h task still takes the 10:00 gap
    expect(hhmm((await proposeSlotOnDay([tl.id], 60, day, { requesterRole: "ADMIN", requesterId: admin.id }))!.slot.start)).toBe("10:00");
  });

  it("a task longer than any single block may still be split across that day's free time (as Up next does)", async () => {
    const { admin, tl } = await seedBasics();
    const day = nextKey(2);
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    // 8h on an empty day: 10:00–13:30 + 14:30–19:00 (lunch 13:30–14:30)
    const r = await proposeSlotOnDay([tl.id], 480, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(r!.onRequestedDay).toBe(true);
    expect(hhmm(r!.slot.start)).toBe("10:00");
    expect(hhmm(r!.slot.end)).toBe("19:00");
    expect(r!.slot.chunks).toHaveLength(2);
    // 8h 30m is more than the day has → the next working day
    const more = await proposeSlotOnDay([tl.id], 510, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(more!.onRequestedDay).toBe(false);
  });

  it("a full day falls back to the next free slot from that day onward and says so", async () => {
    const { admin, tl, client } = await seedBasics();
    const day = nextKey(2);
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [tl.id], start: at(day, "10:00"), end: at(day, "19:00") });
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    const r = await proposeSlotOnDay([tl.id], 60, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(r).not.toBeNull();
    expect(r!.onRequestedDay).toBe(false);
    expect(r!.requestedDayOff).toBe(false);
    expect(r!.requestedDay).toBe(day);
    expect(dateKey(r!.slot.start, TZ)).toBe(nextKey(3, parseDateKey(day, TZ))); // Wednesday
    expect(hhmm(r!.slot.start)).toBe("10:00");
    // a short task still fits in the one hour left before the end of the day
    await testDb.task.deleteMany();
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [tl.id], start: at(day, "10:00"), end: at(day, "18:00") });
    const late = await proposeSlotOnDay([tl.id], 60, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(late!.onRequestedDay).toBe(true);
    expect(hhmm(late!.slot.start)).toBe("18:00");
    // but a longer one does not fit on that day any more
    const long = await proposeSlotOnDay([tl.id], 90, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(long!.onRequestedDay).toBe(false);
  });

  it("the fallback also prefers a gap the whole task fits in, over splitting it across a nearer day", async () => {
    const { admin, tl, client } = await seedBasics();
    const day = nextKey(2);
    const next = nextKey(3, parseDateKey(day, TZ)); // Wednesday: two 1h gaps only
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [tl.id], start: at(day, "10:00"), end: at(day, "19:00") });
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [tl.id], start: at(next, "11:00"), end: at(next, "12:00") });
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [tl.id], start: at(next, "13:00"), end: at(next, "19:00") });
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    const r = await proposeSlotOnDay([tl.id], 120, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(r!.onRequestedDay).toBe(false);
    expect(dateKey(r!.slot.start, TZ)).toBe(nextKey(4, parseDateKey(day, TZ))); // Thursday 10:00, in one piece
    expect(hhmm(r!.slot.start)).toBe("10:00");
    expect(r!.slot.chunks).toHaveLength(1);
    // a 1h task fits Wednesday's first gap
    const short = await proposeSlotOnDay([tl.id], 60, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(dateKey(short!.slot.start, TZ)).toBe(next);
    expect(hhmm(short!.slot.start)).toBe("10:00");
  });

  it("a day with no working hours (Sunday) is reported as a day off and the task goes to Monday", async () => {
    const { admin, tl } = await seedBasics();
    const sunday = nextKey(0);
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    const r = await proposeSlotOnDay([tl.id], 60, sunday, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(r!.onRequestedDay).toBe(false);
    expect(r!.requestedDayOff).toBe(true);
    expect(dateKey(r!.slot.start, TZ)).toBe(nextKey(1, parseDateKey(sunday, TZ)));
  });

  it("approved leave that day moves the task to the next day", async () => {
    const { admin, tl } = await seedBasics();
    const day = nextKey(2);
    const dateOnly = new Date(`${day}T00:00:00Z`);
    await testDb.leave.create({ data: { userId: tl.id, from: dateOnly, to: dateOnly, status: "HR_APPROVED" } });
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    const r = await proposeSlotOnDay([tl.id], 60, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(r!.onRequestedDay).toBe(false);
    expect(dateKey(r!.slot.start, TZ)).not.toBe(day);
    expect(r!.slot.start.getTime()).toBeGreaterThan(parseDateKey(day, TZ).getTime());
  });

  it("today: never in the past — the search starts now", async () => {
    const { admin, tl } = await seedBasics();
    const today = dateKey(new Date(), TZ);
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    const r = await proposeSlotOnDay([tl.id], 30, today, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(r).not.toBeNull();
    expect(r!.slot.start.getTime()).toBeGreaterThanOrEqual(Date.now() - 60_000);
    expect(r!.slot.start.getSeconds()).toBe(0);
    if (r!.onRequestedDay) expect(dateKey(r!.slot.start, TZ)).toBe(today);
    else expect(r!.slot.start.getTime()).toBeGreaterThan(Date.now()); // after hours → a later day
  });

  it("a day before today is refused", async () => {
    const { admin, tl } = await seedBasics();
    const yesterday = dateKey(addDays(new Date(), -1), TZ);
    const { proposeSlotOnDay, PAST_DAY_MESSAGE } = await import("@/server/scheduling/day-slot");
    await expect(proposeSlotOnDay([tl.id], 60, yesterday, { requesterRole: "ADMIN", requesterId: admin.id })).rejects.toThrow(PAST_DAY_MESSAGE);
  });

  it("prefers a later day to displacing a subordinate's self-assigned task on the requested day", async () => {
    const { admin, exec, client } = await seedBasics();
    const day = nextKey(2);
    const soft = await busyBlock({ clientId: client.id, createdById: exec.id, assigneeIds: [exec.id], start: at(day, "10:00"), end: at(day, "19:00"), selfAssigned: true });
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    const r = await proposeSlotOnDay([exec.id], 60, day, { requesterRole: "ADMIN", requesterId: admin.id });
    expect(r!.onRequestedDay).toBe(false);
    expect(r!.slot.displaced).toEqual([]);
    expect(dateKey(r!.slot.start, TZ)).not.toBe(day);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: soft.id } })).scheduledStart!.getTime()).toBe(at(day, "10:00").getTime());
  });
});

describe("createTask / previewSlot / updateTask with a date-only start", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("stores a real instant on that day inside working hours (never a UTC midnight) and reports where it landed", async () => {
    const { admin, tl, client, team } = await seedBasics();
    const work = await anyTeamWorkType();
    const day = nextKey(2);
    session.set(admin);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ title: "Banner", clientId: client.id, teamIds: [team.id], tagIds: [work.id], allocatedMinutes: 90, scheduledStart: day });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.day).toEqual({ requestedDay: day, onRequestedDay: true, requestedDayOff: false });
    expect(res.data.slot).not.toBeNull();
    const t = await loadTask(res.data.taskId);
    expect(t.assignees.map((a) => a.userId)).toEqual([tl.id]);
    expect(dateKey(t.scheduledStart!, TZ)).toBe(day);
    expect(hhmm(t.scheduledStart!)).toBe("10:00");
    expect(t.scheduledStart!.toISOString()).not.toBe(`${day}T00:00:00.000Z`);
    expect(t.scheduledEnd!.getTime()).toBe(t.scheduledStart!.getTime() + 90 * 60000);
    // the next one for the same Team Leader lands after it, still on that day
    const second = await createTask({ title: "Second", clientId: client.id, teamIds: [team.id], tagIds: [work.id], allocatedMinutes: 60, scheduledStart: day });
    if (!second.ok) throw new Error(second.error);
    const t2 = await loadTask(second.data.taskId);
    expect(t2.scheduledStart!.getTime()).toBeGreaterThanOrEqual(t.scheduledEnd!.getTime());
    expect(dateKey(t2.scheduledStart!, TZ)).toBe(day);
    expect(second.data.day?.onRequestedDay).toBe(true);
  });

  it("an explicit start and 'up next' (null) behave as before and carry no day", async () => {
    const { admin, tl, client, team } = await seedBasics();
    session.set(admin);
    const day = nextKey(2);
    const start = at(day, "14:00");
    const { createTask } = await import("@/server/tasks/create");
    const explicit = await loadTask(await createTaskAs(client.id, [tl.id], { scheduledStart: start.toISOString(), allocatedMinutes: 45 }));
    expect(explicit.scheduledStart!.toISOString()).toBe(start.toISOString());
    const res = await createTask({ title: "x", clientId: client.id, teamIds: [team.id], tagIds: [(await anyTeamWorkType()).id] });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.day).toBeUndefined();
  });

  it("a full day falls back and the result says so; the repeat rule anchors on the day it actually got", async () => {
    const { admin, tl, client, team } = await seedBasics();
    const work = await anyTeamWorkType();
    const day = nextKey(2);
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [tl.id], start: at(day, "10:00"), end: at(day, "19:00") });
    session.set(admin);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ title: "Overflow", clientId: client.id, teamIds: [team.id], tagIds: [work.id], allocatedMinutes: 60, scheduledStart: day, recurrence: { freq: "DAILY" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.day).toMatchObject({ requestedDay: day, onRequestedDay: false, requestedDayOff: false });
    const t = await loadTask(res.data.taskId);
    const landed = dateKey(t.scheduledStart!, TZ);
    expect(landed).not.toBe(day);
    expect(landed > day).toBe(true);
    expect(t.recurrenceRule!.anchorDate).toBe(landed);
    expect(dateKey(t.recurrenceRule!.nextRunAt!, TZ) > landed).toBe(true);
  });

  it("a date-only all-day meeting covers that whole day in the meeting zone", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const day = nextKey(2);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ type: "MEETING", title: "Offsite", clientId: client.id, assigneeIds: [tl.id], scheduledStart: day, meetingOptions: { allDay: true, timeZone: "America/New_York" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.day).toBeUndefined();
    const t = await loadTask(res.data.taskId);
    expect(t.scheduledStart!.toISOString()).toBe(parseDateKey(day, "America/New_York").toISOString());
    expect(t.scheduledEnd!.getTime() - t.scheduledStart!.getTime()).toBe(24 * 3600_000);
  });

  it("a timed meeting on a day finds the next free time for organiser + attendees", async () => {
    const { admin, tl, client } = await seedBasics();
    const day = nextKey(2);
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [admin.id], start: at(day, "10:00"), end: at(day, "11:00") });
    session.set(admin);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ type: "MEETING", title: "Sync", clientId: client.id, assigneeIds: [tl.id], allocatedMinutes: 30, scheduledStart: day });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = await loadTask(res.data.taskId);
    expect(t.assignees.map((a) => a.userId).sort()).toEqual([admin.id, tl.id].sort());
    expect(dateKey(t.scheduledStart!, TZ)).toBe(day);
    expect(hhmm(t.scheduledStart!)).toBe("11:00");
  });

  it("a day before today is rejected with a clear message and nothing is saved", async () => {
    const { admin, client, team } = await seedBasics();
    session.set(admin);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ title: "x", clientId: client.id, teamIds: [team.id], tagIds: [(await anyTeamWorkType()).id], scheduledStart: dateKey(addDays(new Date(), -2), TZ) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/That day has passed/);
    expect(await testDb.task.count()).toBe(0);
  });

  it("previewSlot with a day returns the next free time on that day and whether it fell back", async () => {
    const { admin, tl, client } = await seedBasics();
    const day = nextKey(2);
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [tl.id], start: at(day, "10:00"), end: at(day, "11:30") });
    session.set(admin);
    const { previewSlot } = await import("@/server/tasks/create");
    const r = await previewSlot([tl.id], 60, "WORK", day);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data!.day).toEqual({ requestedDay: day, onRequestedDay: true, requestedDayOff: false });
    expect(hhmm(r.data!.start)).toBe("11:30");
    expect(dateKey(r.data!.start, TZ)).toBe(day);
    // without a day: unchanged — the next free slot from now, no day info
    const plain = await previewSlot([tl.id], 60);
    expect(plain.ok && plain.data && plain.data.day).toBeUndefined();
    // a malformed day is refused; so is a day for someone this user may not assign
    expect((await previewSlot([tl.id], 60, "WORK", "23-10-2026")).ok).toBe(false);
    session.set((await testDb.user.findFirstOrThrow({ where: { role: "EXECUTIVE" } })));
    expect((await previewSlot([tl.id], 60, "WORK", day)).ok).toBe(false);
  });

  it("updateTask resolves a date-only start for the task's people, skipping the task itself", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const day = nextKey(2);
    const id = await createTaskAs(client.id, [tl.id], { scheduledStart: at(day, "10:00").toISOString(), allocatedMinutes: 30 });
    const other = nextKey(3, parseDateKey(day, TZ)); // Wednesday
    await busyBlock({ clientId: client.id, createdById: admin.id, assigneeIds: [tl.id], start: at(other, "10:00"), end: at(other, "13:00") });
    const { updateTask } = await import("@/server/tasks/manage");
    const up = await updateTask({ id, scheduledStart: other });
    expect(up.ok).toBe(true);
    const t = await loadTask(id);
    expect(dateKey(t.scheduledStart!, TZ)).toBe(other);
    expect(hhmm(t.scheduledStart!)).toBe("13:00"); // after the 10–13 block (lunch is 13:30–14:30)
    expect(t.scheduledStart!.toISOString()).not.toBe(`${other}T00:00:00.000Z`);
    expect(t.scheduledEnd!.getTime()).toBe(t.scheduledStart!.getTime() + 30 * 60000);
    // moving it back onto its own original day does not collide with itself
    const back = await updateTask({ id, scheduledStart: day });
    expect(back.ok).toBe(true);
    expect(hhmm((await loadTask(id)).scheduledStart!)).toBe("10:00");
  });
});
