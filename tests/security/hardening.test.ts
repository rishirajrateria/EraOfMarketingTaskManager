import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();

describe("security hardening", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("sanitises rich-text descriptions on write", async () => {
    const { sanitizeDescription } = await import("@/lib/sanitize");
    const dirty = '<p onclick="x()">hi<script>alert(1)</script><a href="javascript:alert(1)">l</a><a href="https://ok.example">ok</a><img src=x onerror=alert(1)></p>';
    const clean = sanitizeDescription(dirty);
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(clean).not.toContain("<img");
    expect(clean).toContain('href="https://ok.example"');
  });

  it("serves non-media attachments as downloads with a safe content type", async () => {
    const { safeMime } = await import("@/lib/sanitize");
    expect(safeMime("text/html")).toBe("application/octet-stream");
    expect(safeMime("image/svg+xml")).toBe("application/octet-stream");
    expect(safeMime("image/png")).toBe("image/png");
    expect(safeMime("audio/webm;codecs=opus")).toBe("audio/webm");
  });

  it("client sanitiser neutralises entity-encoded javascript URLs", async () => {
    const { sanitizeHtml } = await import("@/components/dashboard/format");
    expect(sanitizeHtml('<a href="&#106;avascript:alert(1)">x</a>')).toContain('href="#"');
    expect(sanitizeHtml('<a href="data:text/html,x">x</a>')).toContain('href="#"');
    expect(sanitizeHtml('<a href="https://ok.example/a">x</a>')).toContain('href="https://ok.example/a"');
    expect(sanitizeHtml('<form action="javascript:1"><meta http-equiv="refresh"></form>')).not.toMatch(/<form|<meta/);
  });

  it("rejects forged request kinds in raiseReviewRequest", async () => {
    const { tl, exec, client } = await seedBasics();
    const t = await testDb.task.create({ data: { title: "t", clientId: client.id, createdById: tl.id, assignees: { create: [{ userId: exec.id }] } } });
    session.set(exec);
    const { raiseReviewRequest } = await import("@/server/tasks/lifecycle");
    const r = await raiseReviewRequest(t.id, "FINISH" as unknown as "REVIEW", "x");
    expect(r.ok).toBe(false);
    expect(await testDb.request.count()).toBe(0);
  });

  it("previewSlot refuses assignees the caller may not assign", async () => {
    const { exec, tl } = await seedBasics();
    session.set(exec);
    const { previewSlot } = await import("@/server/tasks/create");
    expect((await previewSlot([tl.id], 60)).ok).toBe(false);
    expect((await previewSlot([exec.id], 60)).ok).toBe(true);
  });

  it("only Admin (or the owner of a self-assigned task) can star a task", async () => {
    const { admin, exec, client } = await seedBasics();
    const t = await testDb.task.create({ data: { title: "t", clientId: client.id, createdById: admin.id, assignees: { create: [{ userId: exec.id }] } } });
    const { toggleImportant } = await import("@/server/tasks/manage");
    session.set(exec);
    expect((await toggleImportant(t.id)).ok).toBe(false);
    session.set(admin);
    expect((await toggleImportant(t.id)).ok).toBe(true);
  });

  it("resolveRequest cannot approve FINISH requests out of band", async () => {
    const { admin, tl, client } = await seedBasics();
    const t = await testDb.task.create({ data: { title: "t", clientId: client.id, createdById: admin.id, status: "FINISH_REQUESTED", assignees: { create: [{ userId: tl.id }] } } });
    const req = await testDb.request.create({ data: { type: "FINISH", taskId: t.id, raisedById: tl.id, targetRole: "ADMIN" } });
    session.set(admin);
    const { resolveRequest } = await import("@/server/requests/actions");
    expect((await resolveRequest(req.id, "APPROVED")).ok).toBe(false);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("FINISH_REQUESTED");
  });

  it("HR cannot overwrite a day covered by an approved leave; Admin can", async () => {
    const { admin, hr, exec } = await seedBasics();
    const date = new Date(Date.UTC(2026, 9, 12));
    await testDb.leave.create({ data: { userId: exec.id, from: date, to: date, status: "HR_APPROVED" } });
    const { markAttendance } = await import("@/server/attendance/actions");
    session.set(hr);
    expect((await markAttendance({ userId: exec.id, date: "2026-10-12", status: "PRESENT" })).ok).toBe(false);
    session.set(admin);
    expect((await markAttendance({ userId: exec.id, date: "2026-10-12", status: "PRESENT" })).ok).toBe(true);
  });

  it("masks database engine errors from callers", async () => {
    const { publicMessage } = await import("@/lib/action-result");
    const { Prisma } = await import("@prisma/client");
    const e = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`email`)", { code: "P2002", clientVersion: "x" });
    expect(publicMessage(e)).toBe("A record with the same unique value already exists");
    expect(publicMessage(new Error("Task not found"))).toBe("Task not found");
  });

  it("vault grantees exclude HR and CA", async () => {
    await seedBasics();
    const { listGrantableUsers } = await import("@/server/vault/queries");
    const roles = (await listGrantableUsers()).map((u) => u.role);
    expect(roles).not.toContain("HR");
    expect(roles).not.toContain("ADMIN");
  });
});
