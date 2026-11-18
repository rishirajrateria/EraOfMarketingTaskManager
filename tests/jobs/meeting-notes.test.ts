import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { createTaskAs, settle } from "../tasks/helpers";

const session = mockSession();

describe("Google set per task + meeting-notes job (ADR 0015, GOOGLE_MOCK)", () => {
  beforeEach(async () => {
    await resetDb();
    const { mockMeet } = await import("@/google/meet");
    mockMeet.reset();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("work and meeting tasks get a title-named Drive folder + 'Meeting notes', and a configured Meet space", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const work = await createTaskAs(client.id, [tl.id], { title: "Diwali reel" });
    const twin = await createTaskAs(client.id, [tl.id], { title: "Diwali reel" });
    const meeting = await createTaskAs(client.id, [tl.id], { type: "MEETING", title: "Kickoff", allocatedMinutes: 30 });
    await settle(150);
    const { processPending } = await import("@/google/queue");
    await processPending();
    const rows = await testDb.task.findMany({ where: { id: { in: [work, twin, meeting] } } });
    for (const t of rows) {
      expect(t.driveFolderId, t.title).toBeTruthy();
      expect(t.meetNotesFolderId, t.title).toBeTruthy();
      expect(t.meetLink, t.title).toMatch(/^https:\/\/meet\.google\.com\//);
      expect(t.meetSpaceName, t.title).toMatch(/^spaces\//);
    }
    const byId = new Map(rows.map((t) => [t.id, t]));
    expect(byId.get(meeting)!.chatSpaceId).toBeNull(); // meetings: no Chat space
    expect(byId.get(work)!.chatSpaceId).toBeTruthy();
    expect(byId.get(work)!.driveFolderId).not.toBe(byId.get(twin)!.driveFolderId); // same title → suffixed name
    const cfg = await testDb.integrationJob.findFirstOrThrow({ where: { taskId: work, kind: "MEET_CONFIG" } });
    expect(cfg.status).toBe("OK");
    expect(cfg.result).toMatchObject({ accessType: "OPEN", smartNotes: true, warnings: [] });
  });

  it("files the Gemini notes Doc into the task's 'Meeting notes' folder once, after the meeting", async () => {
    const { admin, tl, client } = await seedBasics();
    session.set(admin);
    const id = await createTaskAs(client.id, [tl.id], { type: "MEETING", title: "Review call", allocatedMinutes: 30 });
    await settle(150);
    const { processPending } = await import("@/google/queue");
    await processPending();
    const { run } = await import("@/jobs/meeting-notes");
    const { filedMockDocs } = await import("@/google/drive");

    // before the meeting: nothing to file (and not even looked at — it hasn't started)
    expect((await run(new Date())).filed).toBe(0);

    // the meeting happened yesterday
    const start = new Date(Date.now() - 26 * 3600_000);
    await testDb.task.update({ where: { id }, data: { scheduledStart: start, scheduledEnd: new Date(start.getTime() + 30 * 60_000) } });
    const first = await run(new Date());
    expect(first).toMatchObject({ tasks: 1, filed: 1, warnings: [] });
    const notes = await testDb.taskMeetingNote.findMany({ where: { taskId: id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "SMART_NOTES", filedAs: "MOVED" });
    const task = await testDb.task.findUniqueOrThrow({ where: { id } });
    expect(filedMockDocs.get(notes[0]!.docId)).toBe(task.meetNotesFolderId);

    // idempotent
    expect((await run(new Date())).filed).toBe(0);
    expect(await testDb.taskMeetingNote.count({ where: { taskId: id } })).toBe(1);

    // deleted tasks and tasks older than 30 days are skipped
    await testDb.task.update({ where: { id }, data: { scheduledStart: new Date(Date.now() - 40 * 86400_000), scheduledEnd: new Date(Date.now() - 40 * 86400_000) } });
    expect((await run(new Date())).tasks).toBe(0);
  });

  it("is registered as a job (cron every 30 minutes)", async () => {
    const { JOBS } = await import("@/jobs/registry");
    expect("meeting-notes" in JOBS).toBe(true);
    const fs = await import("fs");
    const cron = JSON.parse(fs.readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(cron.crons).toContainEqual({ path: "/api/jobs/meeting-notes", schedule: "*/30 * * * *" });
  });
});
