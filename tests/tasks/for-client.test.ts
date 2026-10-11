import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { loadTask, settle } from "./helpers";

const session = mockSession();
const TZ = "Asia/Kolkata";
const dayAhead = (n: number) => formatInTimeZone(addDays(new Date(), n), TZ, "yyyy-MM-dd");

async function clientTask(clientId: string, extra: Record<string, unknown> = {}) {
  const { createTask } = await import("@/server/tasks/create");
  return createTask({ title: "Send the product photos", clientId, forClient: true, scheduledStart: dayAhead(4), ...extra });
}

describe("For-client tasks (things needed from the client)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("Admin: no team / work type / hours, assigned to the creating Admin, deadline only, and NO Google integrations", async () => {
    const { admin, client, team } = await seedBasics();
    session.set(admin);
    // team / tag / assignee input is ignored for a client task
    const res = await clientTask(client.id, { teamIds: [team.id], assigneeIds: [admin.id], allocatedMinutes: 300 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = await testDb.task.findUniqueOrThrow({ where: { id: res.data.taskId }, include: { assignees: true, teams: true, tags: true } });
    expect(t).toMatchObject({ forClient: true, deadlineOnly: true, allocatedMinutes: 0, type: "WORK", selfAssigned: false, protected: false });
    expect(t.assignees.map((a) => a.userId)).toEqual([admin.id]);
    expect(t.teams).toEqual([]);
    expect(t.tags).toEqual([]);
    expect(t.scheduledStart!.toISOString()).toBe(fromZonedTime(`${dayAhead(4)}T19:00:00`, TZ).toISOString());
    expect(await testDb.integrationJob.count({ where: { taskId: t.id } })).toBe(0);
    expect(await testDb.notification.count({ where: { taskId: t.id } })).toBe(0);

    // editing it queues no Calendar / Drive / Chat propagation; the Drive folder is refused; its files stay in the app
    const { updateTask, ensureTaskDriveFolder, assignExecutives } = await import("@/server/tasks/manage");
    expect((await updateTask({ id: t.id, title: "Send the photos", scheduledStart: dayAhead(6) })).ok).toBe(true);
    expect(await testDb.integrationJob.count({ where: { taskId: t.id } })).toBe(0);
    const drive = await ensureTaskDriveFolder(t.id);
    expect(drive.ok || drive.error).toBe("Client tasks have no Drive folder");
    expect((await assignExecutives(t.id, [admin.id])).ok).toBe(false);
    const { processPending } = await import("@/google/queue");
    await processPending();
    const after = await loadTask(t.id);
    expect([after.driveFolderId, after.calendarEventId, after.chatSpaceId, after.meetLink]).toEqual([null, null, null, null]);
    expect(formatInTimeZone(after.scheduledStart!, TZ, "yyyy-MM-dd")).toBe(dayAhead(6));
  });

  it("needs a client and a 'needed by' date; Team Leaders and Executives cannot add one", async () => {
    const { admin, tl, exec, client } = await seedBasics();
    session.set(admin);
    const noDate = await clientTask(client.id, { scheduledStart: null });
    expect(noDate.ok || noDate.error).toBe("Pick the date it is needed by");
    const meeting = await clientTask(client.id, { type: "MEETING" });
    expect(meeting.ok).toBe(false);
    for (const u of [tl, exec]) {
      session.set(u);
      const r = await clientTask(client.id);
      expect(r.ok || r.error).toMatch(/Only Admin/);
    }
  });

  it("Team Leaders / Executives never see it, and only Admin changes its status", async () => {
    const { admin, tl, exec, client, team } = await seedBasics();
    session.set(admin);
    const res = await clientTask(client.id);
    if (!res.ok) throw new Error(res.error);
    const id = res.data.taskId;
    const { listTasks, canView } = await import("@/server/tasks/queries");
    const tlUser = { id: tl.id, role: "TEAM_LEADER" as const, teamId: team.id, teamLeaderId: null };
    const execUser = { id: exec.id, role: "EXECUTIVE" as const, teamId: team.id, teamLeaderId: tl.id };
    expect((await listTasks(tlUser, { includeCompleted: true })).map((t) => t.id)).not.toContain(id);
    expect((await listTasks(execUser, { includeCompleted: true })).map((t) => t.id)).not.toContain(id);
    expect(await canView(tlUser, id)).toBe(false);
    const adminRow = (await listTasks({ id: admin.id, role: "ADMIN", teamId: null, teamLeaderId: null })).find((t) => t.id === id);
    expect(adminRow).toMatchObject({ forClient: true, deadlineOnly: true, teams: [] });

    const { completeFromMySide, startTask } = await import("@/server/tasks/lifecycle");
    session.set(tl);
    expect((await completeFromMySide(id)).ok).toBe(false);
    expect((await startTask(id)).ok).toBe(false);
    expect((await loadTask(id)).status).toBe("ASSIGNED");
    session.set(admin);
    const done = await completeFromMySide(id);
    expect(done.ok && done.data.kind).toBe("complete");
    expect((await loadTask(id)).status).toBe("COMPLETED");
  });
});
