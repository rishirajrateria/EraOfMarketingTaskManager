/**
 * ADR 0021 — Assign / Change person (single pick) by the Team Leader (own team) and by Admin, with "Task moved"
 * notifications; audit fixes B1 (only the caller's team's people are replaced) and B2 (TL / Exec work is forced to
 * their own team).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { anyTeamWorkType, loadTask, settle } from "./helpers";

const session = mockSession();

async function seed() {
  const base = await seedBasics();
  const exec2 = await testDb.user.create({ data: { email: "arjun@test.local", name: "Arjun Kumar", role: "EXECUTIVE", teamId: base.team.id, teamLeaderId: base.tl.id, activatedAt: new Date() } });
  const other = await testDb.team.create({ data: { name: "SEO" } });
  const otherTl = await testDb.user.create({ data: { email: "karan@test.local", name: "Karan Mehta", role: "TEAM_LEADER", teamId: other.id, activatedAt: new Date() } });
  await testDb.team.update({ where: { id: other.id }, data: { leaderId: otherTl.id } });
  const otherExec = await testDb.user.create({ data: { email: "sana@test.local", name: "Sana Ali", role: "EXECUTIVE", teamId: other.id, teamLeaderId: otherTl.id, activatedAt: new Date() } });
  const work = await anyTeamWorkType();
  return { ...base, exec2, other, otherTl, otherExec, work };
}
type Seed = Awaited<ReturnType<typeof seed>>;

async function adminTask(s: Seed, teamIds: string[]) {
  session.set(s.admin);
  const { createTask } = await import("@/server/tasks/create");
  const res = await createTask({ title: "Festive reel scripts", clientId: s.client.id, teamIds, tagIds: [s.work.id], allocatedMinutes: 60 });
  if (!res.ok) throw new Error(res.error);
  await settle(50);
  return res.data.taskId;
}

const notes = (taskId: string, userId: string) => testDb.notification.findMany({ where: { taskId, userId }, orderBy: { createdAt: "asc" }, select: { kind: true, title: true } });

describe("Assign / Change person (ADR 0021)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("TL hands it to an executive, then moves it to another: the old and new person hear it, the TL does not", async () => {
    const s = await seed();
    const id = await adminTask(s, [s.team.id]);
    const { assignExecutives } = await import("@/server/tasks/manage");
    session.set(s.tl);
    expect((await assignExecutives(id, [s.exec.id])).ok).toBe(true);
    expect(await notes(id, s.exec.id)).toEqual([{ kind: "TASK_ASSIGNED", title: "Assigned to you by Rishi" }]);
    await testDb.notification.deleteMany({});
    expect(await assignExecutives(id, [s.exec2.id])).toEqual({ ok: true, data: { assigneeIds: [s.exec2.id] } });
    expect((await loadTask(id)).assignees.map((a) => a.userId)).toEqual([s.exec2.id]);
    expect(await notes(id, s.exec.id)).toEqual([{ kind: "TASK_REASSIGNED", title: "Task moved to Arjun" }]);
    expect(await notes(id, s.exec2.id)).toEqual([{ kind: "TASK_REASSIGNED", title: "Task moved to you · by Rishi" }]);
    expect(await testDb.notification.count({ where: { taskId: id, userId: s.tl.id } })).toBe(0);
    // Drive / Chat / Calendar membership follows via the existing jobs
    const kinds = (await testDb.integrationJob.findMany({ where: { taskId: id } })).map((j) => j.kind);
    expect(kinds).toEqual(expect.arrayContaining(["CALENDAR_UPDATE", "DRIVE_SHARE", "CHAT_MEMBERS"]));
  });

  it("Admin moves it back to the Team Leader: the executive and the TL hear it, Admin does not", async () => {
    const s = await seed();
    const id = await adminTask(s, [s.team.id]);
    const { assignExecutives } = await import("@/server/tasks/manage");
    session.set(s.tl);
    await assignExecutives(id, [s.exec.id]);
    await testDb.notification.deleteMany({});
    session.set(s.admin);
    expect(await assignExecutives(id, [s.tl.id])).toEqual({ ok: true, data: { assigneeIds: [s.tl.id] } });
    expect(await notes(id, s.exec.id)).toEqual([{ kind: "TASK_REASSIGNED", title: "Task moved to Rishi" }]);
    expect(await notes(id, s.tl.id)).toEqual([{ kind: "TASK_REASSIGNED", title: "Task moved to you · by Admin" }]);
    expect(await testDb.notification.count({ where: { taskId: id, userId: s.admin.id } })).toBe(0);
  });

  it("a TL cannot reassign another team's task or pick someone outside the team", async () => {
    const s = await seed();
    const id = await adminTask(s, [s.team.id]);
    const { assignExecutives } = await import("@/server/tasks/manage");
    session.set(s.otherTl);
    expect(await assignExecutives(id, [s.otherExec.id])).toEqual({ ok: false, error: "You can only assign tasks of your own team" });
    session.set(s.tl);
    expect((await assignExecutives(id, [s.otherExec.id])).ok).toBe(false);
  });

  it("B1: on a multi-team task a TL replaces only their own team's people", async () => {
    const s = await seed();
    const id = await adminTask(s, [s.team.id, s.other.id]);
    expect((await loadTask(id)).assignees.map((a) => a.userId).sort()).toEqual([s.tl.id, s.otherTl.id].sort());
    const { assignExecutives } = await import("@/server/tasks/manage");
    session.set(s.tl);
    const res = await assignExecutives(id, [s.exec.id]);
    expect(res.ok).toBe(true);
    expect((await loadTask(id)).assignees.map((a) => a.userId).sort()).toEqual([s.exec.id, s.otherTl.id].sort());
    session.set(s.otherTl);
    await assignExecutives(id, [s.otherExec.id]);
    expect((await loadTask(id)).assignees.map((a) => a.userId).sort()).toEqual([s.exec.id, s.otherExec.id].sort());
    // the other TL was moved off by their own change only: nobody tells Karan about Rishi's pick
    expect(await testDb.notification.count({ where: { taskId: id, userId: s.otherTl.id, kind: "TASK_REASSIGNED" } })).toBe(0);
  });

  it("B2: a Team Leader's or Executive's work is forced to their own team, whatever teamIds they send", async () => {
    const s = await seed();
    const { planAssignment } = await import("@/server/tasks/assignment");
    const { taskInputSchema } = await import("@/server/tasks/schema");
    const input = taskInputSchema.parse({ title: "x", clientId: s.client.id, assigneeIds: [s.exec.id], teamIds: [s.other.id], tagIds: [s.work.id] });
    const tlPlan = await planAssignment({ id: s.tl.id, role: "TEAM_LEADER", teamId: s.team.id, teamLeaderId: null }, input, async () => undefined);
    expect(tlPlan.teamIds).toEqual([s.team.id]);
    const execPlan = await planAssignment({ id: s.exec.id, role: "EXECUTIVE", teamId: s.team.id, teamLeaderId: s.tl.id }, { ...input, assigneeIds: [s.exec.id] }, async () => undefined);
    expect(execPlan.teamIds).toEqual([s.team.id]);
    // …and a proposal always carries the TL's own team
    session.set(s.tl);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ title: "x", clientId: s.client.id, teamIds: [s.other.id], tagIds: [s.work.id] });
    expect(res.ok).toBe(true);
    if (res.ok) expect((await loadTask(res.data.taskId).then((t) => testDb.taskTeam.findMany({ where: { taskId: t.id } }))).map((x) => x.teamId)).toEqual([s.team.id]);
  });
});
