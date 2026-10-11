import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { anyTeamWorkType, createTaskAs, loadTask, settle } from "./helpers";
import { deadlineDay, deadlineInstant } from "@/server/tasks/deadline";

const session = mockSession();
const TZ = "Asia/Kolkata";
const key = (d: Date) => formatInTimeZone(d, TZ, "yyyy-MM-dd");
/** The first Mon–Fri at least `ahead` days from now (company time zone): a working day for every default config. */
function workingDayAhead(ahead = 2): string {
  for (let i = ahead; ; i++) {
    const d = addDays(new Date(), i);
    const wd = toZonedTime(d, TZ).getDay();
    if (wd >= 1 && wd <= 5) return key(d);
  }
}

describe("deadline-only tasks", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("stores the due day's working-day end (19:00 IST) as start = end, 0 minutes, and keeps the Google set", async () => {
    const { admin, tl, client, team } = await seedBasics();
    const work = await anyTeamWorkType();
    session.set(admin);
    const day = workingDayAhead(3);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ title: "Brand deck", clientId: client.id, teamIds: [team.id], tagIds: [work.id], allocatedMinutes: 240, deadlineOnly: true, scheduledStart: day });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.slot).toBeNull();
    const t = await loadTask(res.data.taskId);
    expect(t.deadlineOnly).toBe(true);
    expect(t.forClient).toBe(false);
    expect(t.allocatedMinutes).toBe(0);
    expect(t.scheduledStart!.toISOString()).toBe(fromZonedTime(`${day}T19:00:00`, TZ).toISOString());
    expect(t.scheduledEnd!.getTime()).toBe(t.scheduledStart!.getTime());
    expect(t.assignees.map((a) => a.userId)).toEqual([tl.id]);
    const jobs = await testDb.integrationJob.findMany({ where: { taskId: t.id } });
    expect(jobs.map((j) => j.kind).sort()).toEqual(["CALENDAR_EVENT", "CHAT_SPACE", "DRIVE_FOLDER"]);
    const { processPending } = await import("@/google/queue");
    await processPending();
    expect((await loadTask(t.id)).calendarEventId).toBeTruthy(); // an all-day, "free" event on the due day
  });

  it("refuses a missing or past due date, and a deadline-only meeting", async () => {
    const { admin, client, team } = await seedBasics();
    const work = await anyTeamWorkType();
    session.set(admin);
    const { createTask } = await import("@/server/tasks/create");
    const base = { title: "x", clientId: client.id, teamIds: [team.id], tagIds: [work.id], deadlineOnly: true };
    const none = await createTask({ ...base, scheduledStart: null });
    expect(none.ok || none.error).toBe("Pick the due date");
    const past = await createTask({ ...base, scheduledStart: key(addDays(new Date(), -2)) });
    expect(past.ok || past.error).toMatch(/That day has passed/);
    const meeting = await createTask({ ...base, type: "MEETING", tagIds: [], scheduledStart: workingDayAhead() });
    expect(meeting.ok).toBe(false);
  });

  it("is not placed by the slot finder, blocks no time for others and books no hours", async () => {
    const { admin, tl, exec, client, team } = await seedBasics();
    session.set(tl);
    const day = workingDayAhead(2);
    const id = await createTaskAs(client.id, [exec.id], { deadlineOnly: true, scheduledStart: day, allocatedMinutes: 480 });
    expect((await loadTask(id)).allocatedMinutes).toBe(0);

    // busy time: the deadline is not a block; the day's first free slot is still the start of the working day
    const { busyFor } = await import("@/server/scheduling/slot");
    const from = fromZonedTime(`${day}T00:00:00`, TZ);
    const busy = await busyFor(exec.id, from, addDays(from, 1), { requesterRole: "TEAM_LEADER", requesterId: tl.id });
    expect(busy.hard).toEqual([]);
    expect(busy.soft).toEqual([]);
    const { proposeSlotOnDay } = await import("@/server/scheduling/day-slot");
    const placed = await proposeSlotOnDay([exec.id], 9 * 60 - 60, day, { requesterRole: "TEAM_LEADER", requesterId: tl.id });
    expect(placed?.onRequestedDay).toBe(true);
    expect(formatInTimeZone(placed!.slot.start, TZ, "HH:mm")).toBe("10:00");

    // capacity: inventory, the add-task header and the period loads all leave it out
    const { inventoryFor } = await import("@/server/inventory/queries");
    const inv = await inventoryFor({ from, to: from });
    expect(inv.rows.find((r) => r.userId === exec.id && r.date === day)?.assignedMinutes).toBe(0);
    session.set(admin);
    const { addTaskInventory, periodLoads } = await import("@/server/tasks/create");
    const header = await addTaskInventory([team.id]);
    expect(header.ok && header.data.month).toMatchObject({ bookedMinutes: 0, count: 0 });
    const loads = await periodLoads([tl.id]);
    expect(loads.ok && loads.data.month).toEqual({ minutes: 0, count: 0 });
    // the dashboard row carries the flag and 0 minutes (the summary counts no hours for it)
    const { listTasks } = await import("@/server/tasks/queries");
    const row = (await listTasks({ id: admin.id, role: "ADMIN", teamId: null, teamLeaderId: null })).find((r) => r.id === id)!;
    expect(row).toMatchObject({ deadlineOnly: true, forClient: false, allocatedMinutes: 0, colour: "white" });
  });

  it("an edit moves the due day; a timed task is never turned into a slot by leave shifting", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id], { deadlineOnly: true, scheduledStart: workingDayAhead(2) });
    const later = workingDayAhead(6);
    const { updateTask } = await import("@/server/tasks/manage");
    const res = await updateTask({ id, scheduledStart: later, allocatedMinutes: 120 });
    expect(res.ok).toBe(true);
    const t = await loadTask(id);
    expect(key(t.scheduledStart!)).toBe(later);
    expect(t.scheduledEnd!.getTime()).toBe(t.scheduledStart!.getTime());
    expect(t.allocatedMinutes).toBe(0);
    const { shiftTaskToNextSlot } = await import("@/server/scheduling/slot");
    expect(await shiftTaskToNextSlot(id, admin.id, "test")).toBeNull();
  });

  it("deadlineDay / deadlineInstant: a day key or an instant's day, never a past day", () => {
    const now = new Date("2026-10-11T08:00:00Z");
    expect(deadlineDay("2026-10-13", TZ, now)).toBe("2026-10-13");
    expect(deadlineDay("2026-10-13T22:00:00+05:30", TZ, now)).toBe("2026-10-13");
    expect(() => deadlineDay("2026-10-10", TZ, now)).toThrow(/passed/);
    expect(() => deadlineDay(null, TZ, now)).toThrow(/due date/);
    expect(deadlineInstant("2026-10-13", TZ, 1140).toISOString()).toBe("2026-10-13T13:30:00.000Z");
  });
});
