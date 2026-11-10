import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { toZonedTime } from "date-fns-tz";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { anyTeamWorkType, createTaskAs, loadTask, settle } from "./helpers";

const session = mockSession();

describe("createTask", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150); // let createTask's fire-and-forget queue drain before the next resetDb()
  });

  it("Admin → Team Leader: ASSIGNED, auto-proposed slot inside IST working hours, client visible, 3 jobs, notification", async () => {
    const { admin, tl, client, team } = await seedBasics();
    await testDb.client.update({ where: { id: client.id }, data: { visibleInFilters: false } });
    const work = await anyTeamWorkType();
    session.set(admin);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ title: "Design banner", clientId: client.id, teamIds: [team.id], tagIds: [work.id], allocatedMinutes: 90 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.slot).not.toBeNull();
    expect(res.data.slot!.displaced).toEqual([]);

    const t = await loadTask(res.data.taskId);
    expect(t.status).toBe("ASSIGNED");
    expect(t.type).toBe("WORK");
    expect(t.createdById).toBe(admin.id);
    expect(t.assignedById).toBe(admin.id);
    expect(t.selfAssigned).toBe(false);
    expect(t.protected).toBe(false);
    expect(t.assignees.map((a) => a.userId)).toEqual([tl.id]);
    expect(t.scheduledStart).not.toBeNull();
    expect(t.scheduledEnd).not.toBeNull();
    expect(t.scheduledStart!.getTime()).toBeGreaterThanOrEqual(Date.now() - 60_000);
    expect(t.scheduledEnd!.getTime()).toBeGreaterThan(t.scheduledStart!.getTime());
    const local = toZonedTime(t.scheduledStart!, "Asia/Kolkata");
    expect(local.getHours()).toBeGreaterThanOrEqual(10);
    expect(local.getHours()).toBeLessThan(19);
    expect(local.getDay()).not.toBe(0);

    expect((await testDb.client.findUniqueOrThrow({ where: { id: client.id } })).visibleInFilters).toBe(true);

    const jobs = await testDb.integrationJob.findMany({ where: { taskId: t.id } });
    expect(jobs.map((j) => j.kind).sort()).toEqual(["CALENDAR_EVENT", "CHAT_SPACE", "DRIVE_FOLDER"]);

    const notes = await testDb.notification.findMany({ where: { taskId: t.id } });
    expect(notes.map((n) => [n.userId, n.kind])).toEqual([[tl.id, "TASK_ASSIGNED"]]);

    const log = await testDb.auditLog.findFirst({ where: { entityType: "Task", entityId: t.id, action: "task.create" } });
    expect(log?.actorId).toBe(admin.id);
  });

  it("MEETING type queues a Drive folder (for Gemini notes, ADR 0015) and the calendar event — no Chat space", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id], { type: "MEETING", title: "Kickoff", allocatedMinutes: 30 });
    const jobs = await testDb.integrationJob.findMany({ where: { taskId: id } });
    expect(jobs.map((j) => j.kind).filter((k) => k !== "MEET_CONFIG").sort()).toEqual(["CALENDAR_EVENT", "DRIVE_FOLDER"]);
    expect((await loadTask(id)).type).toBe("MEETING");
  });

  it("processPending() fills Drive folder, Meet link and Chat space (mocked Google)", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id]);
    const { processPending } = await import("@/google/queue");
    await processPending();
    const t = await loadTask(id);
    expect(t.driveFolderId).toBeTruthy();
    expect(t.driveFolderUrl).toBeTruthy();
    expect(t.meetLink).toMatch(/^https:\/\/meet\.google\.com\//);
    expect(t.meetActive).toBe(true);
    expect(t.calendarEventId).toBeTruthy();
    expect(t.chatSpaceId).toBeTruthy();
    expect(t.integrationError).toBeNull();
    const jobs = await testDb.integrationJob.findMany({ where: { taskId: id } });
    expect(jobs.every((j) => j.status === "OK")).toBe(true);
  });

  it("Admin cannot assign an Executive directly", async () => {
    const { admin, exec, client, team } = await seedBasics();
    const work = await anyTeamWorkType();
    session.set(admin);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ title: "x", clientId: client.id, assigneeIds: [exec.id], teamIds: [team.id], tagIds: [work.id] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Team Leader/);
    expect(await testDb.task.count()).toBe(0);
  });

  it("ADR 0021: a Team Leader's work task picks no executive (it is a proposal); their meetings still invite anyone", async () => {
    const { tl, exec, client, team } = await seedBasics();
    const work = await anyTeamWorkType();
    session.set(tl);
    const { createTask } = await import("@/server/tasks/create");
    const withExec = await createTask({ title: "own exec", clientId: client.id, assigneeIds: [exec.id], tagIds: [work.id] });
    expect(withExec).toEqual({ ok: false, error: "A proposal goes to Admin first — assign an executive after it is approved" });
    expect(await testDb.task.count()).toBe(0);
    const meeting = await createTask({ type: "MEETING", title: "sync", clientId: client.id, assigneeIds: [exec.id], teamIds: [team.id] });
    expect(meeting.ok).toBe(true);
    if (meeting.ok) {
      const t = await loadTask(meeting.data.taskId);
      expect(t.status).toBe("ASSIGNED");
      expect(t.assignees.map((a) => a.userId).sort()).toEqual([tl.id, exec.id].sort());
    }
  });

  it("ADR 0021: Executives no longer create work tasks", async () => {
    const { tl, exec, client } = await seedBasics();
    const work = await anyTeamWorkType();
    session.set(exec);
    const { createTask } = await import("@/server/tasks/create");
    const self = await createTask({ title: "mine", clientId: client.id, assigneeIds: [exec.id], tagIds: [work.id] });
    expect(self).toEqual({ ok: false, error: "Executives book meetings only — ask your Team Leader for a task" });
    const meeting = await createTask({ type: "MEETING", title: "ask TL", clientId: client.id, assigneeIds: [tl.id] });
    expect(meeting.ok).toBe(true);
    expect(await testDb.task.count({ where: { type: "WORK" } })).toBe(0);
  });

  it("HR cannot create tasks", async () => {
    const { hr, tl, client } = await seedBasics();
    session.set(hr);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ title: "x", clientId: client.id, assigneeIds: [tl.id] });
    expect(res.ok).toBe(false);
  });

  it("missing / unknown client → ok:false", async () => {
    const { admin, tl } = await seedBasics();
    session.set(admin);
    const { createTask } = await import("@/server/tasks/create");
    const empty = await createTask({ title: "x", clientId: "", assigneeIds: [tl.id] });
    expect(empty.ok).toBe(false);
    const unknown = await createTask({ title: "x", clientId: "does-not-exist", assigneeIds: [tl.id] });
    expect(unknown.ok).toBe(false);
    expect(await testDb.task.count()).toBe(0);
  });

  it("validates input: empty title, no assignees, unknown assignee", async () => {
    const { admin, client, team } = await seedBasics();
    const work = await anyTeamWorkType();
    session.set(admin);
    const { createTask } = await import("@/server/tasks/create");
    expect((await createTask({ title: "   ", clientId: client.id, teamIds: [team.id], tagIds: [work.id] })).ok).toBe(false);
    const unknown = await createTask({ title: "x", clientId: client.id, assigneeIds: ["nope"], teamIds: [team.id], tagIds: [work.id] });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toMatch(/Unknown or inactive assignee/);
  });

  it("second task for the same assignee is scheduled after the first (no overlap)", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const first = await loadTask(await createTaskAs(client.id, [tl.id], { title: "first", allocatedMinutes: 120 }));
    const second = await loadTask(await createTaskAs(client.id, [tl.id], { title: "second", allocatedMinutes: 60 }));
    expect(second.scheduledStart!.getTime()).toBeGreaterThanOrEqual(first.scheduledEnd!.getTime());
    // a third one lands after the second
    const third = await loadTask(await createTaskAs(client.id, [tl.id], { title: "third", allocatedMinutes: 60 }));
    expect(third.scheduledStart!.getTime()).toBeGreaterThanOrEqual(second.scheduledEnd!.getTime());
  });

  it("explicit scheduledStart is honoured and end defaults to start + allocatedMinutes", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const start = new Date(Date.now() + 3 * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    const id = await createTaskAs(client.id, [tl.id], { scheduledStart: start.toISOString(), allocatedMinutes: 45 });
    const t = await loadTask(id);
    expect(t.scheduledStart!.toISOString()).toBe(start.toISOString());
    expect(t.scheduledEnd!.getTime()).toBe(start.getTime() + 45 * 60000);
  });

  it("Admin's own work still goes to the team's Team Leader (team-first, ADR 0008)", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const t = await loadTask(await createTaskAs(client.id, [admin.id], { title: "admin own" }));
    expect(t.assignees.map((a) => a.userId).sort()).toEqual([admin.id, tl.id].sort());
    expect(t.selfAssigned).toBe(false);
    // only the Team Leader is notified, never Admin themselves
    expect((await testDb.notification.findMany({ where: { taskId: t.id } })).map((n) => n.userId)).toEqual([tl.id]);
  });

  it("multi-assignee task is not self-assigned", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const t = await loadTask(await createTaskAs(client.id, [admin.id, tl.id]));
    expect(t.selfAssigned).toBe(false);
    expect(t.protected).toBe(false);
    expect(t.assignees.map((a) => a.userId).sort()).toEqual([admin.id, tl.id].sort());
  });
});
