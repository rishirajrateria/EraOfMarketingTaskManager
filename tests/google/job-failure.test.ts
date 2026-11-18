import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { stepLabel } from "@/google/job-failure";

/** ADR 0020: a Google job that exhausts its attempts notifies Admins once and shows up with Retry / Dismiss. */
// processPending re-registers the real handlers each run; stub that so the test handlers below stay in place.
vi.mock("@/google/task-integrations", () => ({ registerTaskIntegrationHandlers: () => undefined }));
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

describe("failed Google jobs", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  const makeFailingJob = async (kind: "DRIVE_FOLDER" | "CALENDAR_EVENT" | "MEET_CONFIG" | "CHAT_SPACE" = "DRIVE_FOLDER") => {
    const task = await testDb.task.create({ data: { title: "Launch reel", clientId: seed.client.id, createdById: seed.admin.id } });
    const job = await testDb.integrationJob.create({ data: { kind, idempotencyKey: `k-${kind}-${task.id}`, taskId: task.id, attempts: 4, payload: {} } });
    return { task, job };
  };

  it("maps each job kind to its Admin-facing step", () => {
    expect([stepLabel("DRIVE_FOLDER"), stepLabel("DRIVE_SHARE"), stepLabel("CALENDAR_EVENT"), stepLabel("MEET_CONFIG"), stepLabel("CHAT_SPACE"), stepLabel("CHAT_MEMBERS")]).toEqual(["Drive", "Drive", "Calendar", "Meet", "Chat", "Chat"]);
  });

  it("the fifth failure marks the job FAILED and notifies every Admin once with the task title and step", async () => {
    const { registerHandler, processPending } = await import("@/google/queue");
    registerHandler("CHAT_SPACE", async () => {
      throw new Error("Chat API down");
    });
    const { task, job } = await makeFailingJob("CHAT_SPACE");
    await processPending();
    const failed = await testDb.integrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.failureNotifiedAt).not.toBeNull();
    const notes = await testDb.notification.findMany({ where: { kind: "INTEGRATION_FAILED" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: seed.admin.id, taskId: task.id });
    expect(notes[0].title).toBe("Google Chat failed");
    // a second notify call (e.g. another worker) does not send again
    const { notifyJobFailed } = await import("@/google/job-failure");
    expect(await notifyJobFailed(job.id)).toBe(false);
    expect(await testDb.notification.count({ where: { kind: "INTEGRATION_FAILED" } })).toBe(1);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: task.id } })).integrationError).toMatch(/^CHAT_SPACE: Chat API down/);
  });

  it("does not notify while attempts remain", async () => {
    const { registerHandler, processPending } = await import("@/google/queue");
    registerHandler("MEET_CONFIG", async () => {
      throw new Error("nope");
    });
    const task = await testDb.task.create({ data: { title: "T", clientId: seed.client.id, createdById: seed.admin.id } });
    const job = await testDb.integrationJob.create({ data: { kind: "MEET_CONFIG", idempotencyKey: "m1", taskId: task.id, payload: {} } });
    await processPending();
    expect((await testDb.integrationJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING");
    expect(await testDb.notification.count({ where: { kind: "INTEGRATION_FAILED" } })).toBe(0);
  });

  it("lists failed jobs for Admin with the task title and step; Dismiss hides one and clears the task badge", async () => {
    const { task, job } = await makeFailingJob("DRIVE_FOLDER");
    await testDb.integrationJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: "quota" } });
    await testDb.task.update({ where: { id: task.id }, data: { integrationError: "DRIVE_FOLDER: quota" } });
    const { listFailedJobs } = await import("@/google/job-failure");
    expect(await listFailedJobs()).toMatchObject([{ id: job.id, step: "Drive", taskTitle: "Launch reel", error: "quota" }]);
    const { dismissGoogleJob } = await import("@/server/admin/google-jobs-actions");
    expect((await dismissGoogleJob(job.id)).ok).toBe(true);
    expect(await listFailedJobs()).toEqual([]);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: task.id } })).integrationError).toBeNull();
    expect(await testDb.auditLog.count({ where: { action: "integration.job.dismiss" } })).toBe(1);
  });

  it("Retry requeues the job (re-arming the notification); both actions are Admin only", async () => {
    const { job } = await makeFailingJob("CALENDAR_EVENT");
    await testDb.integrationJob.update({ where: { id: job.id }, data: { status: "FAILED", failureNotifiedAt: new Date() } });
    const { retryGoogleJob, dismissGoogleJob } = await import("@/server/admin/google-jobs-actions");
    session.set({ id: seed.tl.id, role: "TEAM_LEADER" });
    expect((await retryGoogleJob(job.id)).ok).toBe(false);
    expect((await dismissGoogleJob(job.id)).ok).toBe(false);
    session.set({ id: seed.admin.id, role: "ADMIN" });
    expect((await retryGoogleJob(job.id)).ok).toBe(true);
    const after = await testDb.integrationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ status: "PENDING", attempts: 0, failureNotifiedAt: null, dismissedAt: null });
    expect((await retryGoogleJob(job.id)).ok).toBe(false); // no longer failed
  });

  it("task-less jobs are listed and retried on their own", async () => {
    const job = await testDb.integrationJob.create({ data: { kind: "GMAIL_SEND", idempotencyKey: "g1", status: "FAILED", lastError: "smtp", payload: {} } });
    const { listFailedJobs } = await import("@/google/job-failure");
    expect(await listFailedJobs()).toMatchObject([{ step: "Email", taskTitle: null }]);
    const { retryGoogleJob } = await import("@/server/admin/google-jobs-actions");
    expect((await retryGoogleJob(job.id)).ok).toBe(true);
    expect((await testDb.integrationJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("PENDING");
  });
});
