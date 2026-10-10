import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { createTaskAs, loadTask, settle } from "./helpers";

const session = mockSession();

async function L() {
  return import("@/server/tasks/lifecycle");
}

/** Seeds and creates one Admin → TL task; leaves the session as admin. */
async function setup() {
  const seed = await seedBasics();
  session.set(seed.admin);
  const taskId = await createTaskAs(seed.client.id, [seed.tl.id], { title: "Flow task" });
  return { ...seed, taskId };
}

describe("task lifecycle", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150); // let createTask's fire-and-forget queue drain before the next resetDb()
  });

  it("start → pause → resume → request finish → approve", async () => {
    const { admin, tl, exec, taskId } = await setup();
    const lc = await L();

    // Executive cannot start
    session.set(exec);
    const denied = await lc.startTask(taskId);
    expect(denied.ok).toBe(false);
    expect((await loadTask(taskId)).status).toBe("ASSIGNED");

    // TL starts
    session.set(tl);
    expect((await lc.startTask(taskId)).ok).toBe(true);
    let t = await loadTask(taskId);
    expect(t.status).toBe("STARTED");
    expect(t.actualStart).not.toBeNull();
    expect(t.sessions).toHaveLength(1);
    expect(t.sessions[0].endedAt).toBeNull();
    const started = await testDb.notification.findMany({ where: { taskId, kind: "TASK_STARTED" } });
    expect(started.map((n) => n.userId)).toEqual([admin.id]); // stakeholders minus the actor

    // TL cannot pause; Admin can
    expect((await lc.pauseTask(taskId)).ok).toBe(false);
    session.set(admin);
    expect((await lc.pauseTask(taskId)).ok).toBe(true);
    t = await loadTask(taskId);
    expect(t.status).toBe("PAUSED");
    expect(t.statusBeforePause).toBe("STARTED");
    expect(t.pausedAt).not.toBeNull();
    expect(t.sessions).toHaveLength(1);
    expect(t.sessions[0].endedAt).not.toBeNull();
    const firstActualStart = t.actualStart;
    const endBeforePause = t.scheduledEnd!.getTime();

    // resume (after ~0 minutes)
    expect((await lc.resumeTask(taskId)).ok).toBe(true);
    t = await loadTask(taskId);
    expect(t.status).toBe("STARTED");
    expect(t.statusBeforePause).toBeNull();
    expect(t.pausedAt).toBeNull();
    expect(t.pausedTotalMinutes).toBe(0);
    expect(t.scheduledEnd!.getTime()).toBe(endBeforePause);
    expect(t.actualStart?.getTime()).toBe(firstActualStart?.getTime());
    expect(t.sessions).toHaveLength(2);
    expect(t.sessions.filter((s) => s.endedAt === null)).toHaveLength(1);

    // TL requests finish
    session.set(tl);
    expect((await lc.requestFinish(taskId)).ok).toBe(true);
    t = await loadTask(taskId);
    expect(t.status).toBe("FINISH_REQUESTED");
    expect(t.finishRequestedAt).not.toBeNull();
    expect(t.finishRequestedById).toBe(tl.id);
    expect(t.requests.filter((r) => r.type === "FINISH" && r.status === "OPEN")).toHaveLength(1);
    expect(t.requests[0].targetRole).toBe("ADMIN");
    expect(await testDb.notification.count({ where: { taskId, kind: "FINISH_REQUESTED", userId: admin.id } })).toBe(1);

    // TL cannot approve; Admin approves
    expect((await lc.approveFinish(taskId)).ok).toBe(false);
    session.set(admin);
    expect((await lc.approveFinish(taskId)).ok).toBe(true);
    t = await loadTask(taskId);
    expect(t.status).toBe("COMPLETED");
    expect(t.actualEnd).not.toBeNull();
    expect(t.approvedById).toBe(admin.id);
    // ADR 0015: the Meet link (like Drive and Chat) lives until the task is deleted
    expect(t.meetActive).toBe(true);
    expect(t.meetLink).not.toBeNull();
    expect(t.sessions.every((s) => s.endedAt !== null)).toBe(true);
    expect(t.requests.find((r) => r.type === "FINISH")!.status).toBe("APPROVED");
    expect(await testDb.notification.count({ where: { taskId, kind: "FINISH_APPROVED", userId: tl.id } })).toBe(1);

    // cannot start a completed task
    session.set(tl);
    expect((await lc.startTask(taskId)).ok).toBe(false);
  });

  it("rejectFinish sends the task back to STARTED with a note", async () => {
    const { admin, tl, taskId } = await setup();
    const lc = await L();
    session.set(tl);
    await lc.startTask(taskId);
    await lc.requestFinish(taskId);
    // reject requires FINISH_REQUESTED and Admin
    expect((await lc.rejectFinish(taskId, "nope")).ok).toBe(false);
    session.set(admin);
    expect((await lc.rejectFinish(taskId, "Missing the logo")).ok).toBe(true);
    const t = await loadTask(taskId);
    expect(t.status).toBe("STARTED");
    expect(t.rejectionNote).toBe("Missing the logo");
    expect(t.finishRequestedAt).toBeNull();
    const req = t.requests.find((r) => r.type === "FINISH")!;
    expect(req.status).toBe("REJECTED");
    expect(req.resolutionNote).toBe("Missing the logo");
    expect(await testDb.notification.count({ where: { taskId, kind: "FINISH_REJECTED", userId: tl.id } })).toBe(1);
    // rejecting again is illegal (not FINISH_REQUESTED)
    expect((await lc.rejectFinish(taskId, "again")).ok).toBe(false);
  });

  it("raiseDoubt (TL) and resolveDoubt (Admin)", async () => {
    const { admin, tl, exec, taskId } = await setup();
    const lc = await L();
    session.set(exec);
    expect((await lc.raiseDoubt(taskId, "?")).ok).toBe(false);
    session.set(admin);
    expect((await lc.raiseDoubt(taskId, "?")).ok).toBe(false); // admin cannot raise doubt
    session.set(tl);
    expect((await lc.raiseDoubt(taskId, "Which colour?")).ok).toBe(true);
    let t = await loadTask(taskId);
    expect(t.doubtRaised).toBe(true);
    expect(t.doubtNote).toBe("Which colour?");
    expect(t.requests.filter((r) => r.type === "DOUBT" && r.status === "OPEN")).toHaveLength(1);
    expect(await testDb.notification.count({ where: { taskId, kind: "DOUBT_RAISED", userId: admin.id } })).toBe(1);

    expect((await lc.resolveDoubt(taskId, "Blue")).ok).toBe(false); // TL cannot resolve
    session.set(admin);
    expect((await lc.resolveDoubt(taskId, "Blue")).ok).toBe(true);
    t = await loadTask(taskId);
    expect(t.doubtRaised).toBe(false);
    expect(t.doubtNote).toBeNull();
    const req = t.requests.find((r) => r.type === "DOUBT")!;
    expect(req.status).toBe("RESOLVED");
    expect(req.resolutionNote).toBe("Blue");
    expect(await testDb.notification.count({ where: { taskId, kind: "DOUBT_RESOLVED", userId: tl.id } })).toBe(1);
  });

  it("review request by an Executive on own task; not on someone else's; Admin edit clears it", async () => {
    const { admin, tl, exec, client, taskId: tlTask } = await setup();
    const lc = await L();
    session.set(tl);
    const execTask = await createTaskAs(client.id, [exec.id], { title: "Exec task" });

    session.set(exec);
    const foreign = await lc.raiseReviewRequest(tlTask, "REVIEW", "please");
    expect(foreign.ok).toBe(false);
    expect((await loadTask(tlTask)).reviewRequested).toBe(false);

    expect((await lc.raiseReviewRequest(execTask, "REVIEW", "Need more time")).ok).toBe(true);
    let t = await loadTask(execTask);
    expect(t.reviewRequested).toBe(true);
    expect(t.reviewNote).toBe("Need more time");
    expect(t.requests.filter((r) => r.type === "REVIEW" && r.status === "OPEN")).toHaveLength(1);
    expect(await testDb.notification.count({ where: { taskId: execTask, kind: "REVIEW_REQUESTED", userId: admin.id } })).toBe(1);

    // TIME_CHANGE too
    expect((await lc.raiseReviewRequest(execTask, "TIME_CHANGE", "tomorrow?")).ok).toBe(true);
    expect((await loadTask(execTask)).requests.filter((r) => r.type === "TIME_CHANGE")).toHaveLength(1);

    // Admin edits → dot cleared, requests resolved
    const { updateTask } = await import("@/server/tasks/manage");
    session.set(tl);
    expect((await updateTask({ id: execTask, title: "Exec task v2" })).ok).toBe(false);
    session.set(admin);
    expect((await updateTask({ id: execTask, title: "Exec task v2" })).ok).toBe(true);
    t = await loadTask(execTask);
    expect(t.title).toBe("Exec task v2");
    expect(t.reviewRequested).toBe(false);
    expect(t.reviewNote).toBeNull();
    expect(t.requests.filter((r) => ["REVIEW", "TIME_CHANGE"].includes(r.type)).every((r) => r.status === "RESOLVED" && r.resolvedById === admin.id)).toBe(true);
    expect(t.assignees.map((a) => a.userId)).toEqual([exec.id]); // untouched by a partial update
  });

  it("restartTask duplicates a COMPLETED task into ASSIGNED; rejects non-completed", async () => {
    const { admin, tl, taskId } = await setup();
    const lc = await L();
    session.set(admin);
    expect((await lc.restartTask(taskId)).ok).toBe(false); // ASSIGNED
    session.set(tl);
    await lc.startTask(taskId);
    session.set(admin);
    await lc.approveFinish(taskId);
    session.set(tl); // TL may restart
    const res = await lc.restartTask(taskId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.taskId).not.toBe(taskId);
    const dup = await loadTask(res.data.taskId);
    const orig = await loadTask(taskId);
    expect(dup.status).toBe("ASSIGNED");
    expect(dup.parentTaskId).toBe(taskId);
    expect(dup.title).toBe(orig.title);
    expect(dup.clientId).toBe(orig.clientId);
    expect(dup.allocatedMinutes).toBe(orig.allocatedMinutes);
    expect(dup.assignees.map((a) => a.userId)).toEqual(orig.assignees.map((a) => a.userId));
    expect(dup.actualStart).toBeNull();
    expect(dup.scheduledStart).not.toBeNull();
    expect(dup.driveFolderId).toBeNull(); // restartCreatesNewWorkspace default → fresh workspace
    expect(orig.status).toBe("COMPLETED");
    const jobs = await testDb.integrationJob.findMany({ where: { taskId: dup.id } });
    expect(jobs.map((j) => j.kind).filter((k) => k !== "MEET_CONFIG").sort()).toEqual(["CALENDAR_EVENT", "CHAT_SPACE", "DRIVE_FOLDER"]);
  });

  it("deleteTask removes everything: Google items, sessions, requests, notes; the row is an invisible tombstone", async () => {
    const { admin, tl, taskId } = await setup();
    const lc = await L();
    const { deleteTask } = await import("@/server/tasks/manage");
    const { processPending } = await import("@/google/queue");
    const { trashedMockFiles } = await import("@/google/drive");
    const { mockMeet } = await import("@/google/meet");
    await settle(150);
    await processPending();
    await processPending(); // MEET_CONFIG is queued by CALENDAR_EVENT
    session.set(tl);
    await lc.startTask(taskId);
    await lc.raiseDoubt(taskId, "hmm");
    expect((await deleteTask(taskId)).ok).toBe(false); // Admin only

    const before = await loadTask(taskId);
    expect(before.driveFolderId).not.toBeNull();
    expect(before.chatSpaceId).not.toBeNull();
    expect(before.calendarEventId).not.toBeNull();
    expect(before.meetSpaceName).not.toBeNull();
    await testDb.taskMeetingNote.create({ data: { taskId, kind: "SMART_NOTES", conferenceRecord: "conferenceRecords/x", docId: "doc1", docUrl: "https://docs.google.com/document/d/doc1/edit", filedAs: "MOVED" } });

    session.set(admin);
    const res = await deleteTask(taskId);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.warnings).toEqual([]);
    const gone = await testDb.task.findUniqueOrThrow({ where: { id: taskId }, include: { sessions: true, requests: true, attachments: true, meetingNotes: true } });
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.deletedById).toBe(admin.id);
    expect(gone.sessions).toHaveLength(0);
    expect(gone.requests).toHaveLength(0);
    expect(gone.meetingNotes).toHaveLength(0);
    expect([gone.driveFolderId, gone.chatSpaceId, gone.calendarEventId, gone.meetLink, gone.meetSpaceName]).toEqual([null, null, null, null, null]);
    expect(gone.meetActive).toBe(false);
    expect(trashedMockFiles).toContain(before.driveFolderId);
    expect(mockMeet.spaces.get(before.meetSpaceName!)?.accessType).toBe("RESTRICTED");
    expect(await testDb.integrationJob.count({ where: { taskId, status: "PENDING" } })).toBe(0);
    const audit = await testDb.auditLog.findFirstOrThrow({ where: { entityId: taskId, action: "task.delete" } });
    expect(JSON.stringify(audit.after)).toContain("Drive folder");
    // deleted tasks are no longer visible to actions
    session.set(tl);
    expect((await lc.requestFinish(taskId)).ok).toBe(false);
    session.set(admin);
    expect((await deleteTask(taskId)).ok).toBe(false);
  });

  it("deleteTask keeps a Drive folder / Chat space still used by a restarted copy", async () => {
    const { admin, client, tl } = await setup();
    const { deleteTask } = await import("@/server/tasks/manage");
    const { trashedMockFiles } = await import("@/google/drive");
    const shared = { driveFolderId: "folder_shared", driveFolderUrl: "https://drive.google.com/drive/folders/folder_shared", chatSpaceId: "spaces/shared", chatSpaceUrl: "https://chat.google.com/room/shared" };
    const a = await testDb.task.create({ data: { title: "A", clientId: client.id, createdById: admin.id, status: "COMPLETED", ...shared, assignees: { create: [{ userId: tl.id }] } } });
    await testDb.task.create({ data: { title: "A", clientId: client.id, createdById: admin.id, parentTaskId: a.id, ...shared, assignees: { create: [{ userId: tl.id }] } } });
    session.set(admin);
    const before = trashedMockFiles.length;
    expect((await deleteTask(a.id)).ok).toBe(true);
    expect(trashedMockFiles.length).toBe(before);
    const audit = await testDb.auditLog.findFirstOrThrow({ where: { entityId: a.id, action: "task.delete" } });
    expect(JSON.stringify(audit.after)).toContain("used by the restarted copy");
  });

  it("resolveRequest: HR cannot resolve an ADMIN-targeted request; Admin can", async () => {
    const { admin, tl, hr, taskId } = await setup();
    const lc = await L();
    session.set(tl);
    await lc.raiseDoubt(taskId, "?");
    const req = await testDb.request.findFirstOrThrow({ where: { taskId, type: "DOUBT" } });
    const { resolveRequest } = await import("@/server/requests/actions");
    session.set(hr);
    const denied = await resolveRequest(req.id, "RESOLVED", "ok");
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toMatch(/Not your inbox/);
    expect((await testDb.request.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("OPEN");
    session.set(tl);
    expect((await resolveRequest(req.id, "RESOLVED", "ok")).ok).toBe(false);
    session.set(admin);
    expect((await resolveRequest(req.id, "RESOLVED", "ok")).ok).toBe(true);
    expect((await testDb.request.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("RESOLVED");
    expect((await loadTask(taskId)).doubtRaised).toBe(false);
  });
});
