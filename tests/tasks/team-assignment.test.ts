import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { anyTeamWorkType, loadTask, settle } from "./helpers";

const session = mockSession();

/** seedBasics + a team-bound work type, a second executive (a specialist) and a second team with its own leader. */
async function seed() {
  const base = await seedBasics();
  const work = await testDb.workType.create({ data: { name: "Reels", teams: { connect: [{ id: base.team.id }] } } });
  const exec2 = await testDb.user.create({
    data: { email: "arjun@test.local", name: "Arjun Kumar", role: "EXECUTIVE", teamId: base.team.id, teamLeaderId: base.tl.id, activatedAt: new Date(), specialities: { connect: [{ id: work.id }] } },
  });
  const other = await testDb.team.create({ data: { name: "SEO" } });
  const otherTl = await testDb.user.create({ data: { email: "karan@test.local", name: "Karan Mehta", role: "TEAM_LEADER", teamId: other.id, activatedAt: new Date() } });
  await testDb.team.update({ where: { id: other.id }, data: { leaderId: otherTl.id } });
  const otherExec = await testDb.user.create({ data: { email: "sana@test.local", name: "Sana Ali", role: "EXECUTIVE", teamId: other.id, teamLeaderId: otherTl.id, activatedAt: new Date() } });
  const otherWork = await testDb.workType.create({ data: { name: "Keyword research", teams: { connect: [{ id: other.id }] } } });
  return { ...base, work, exec2, other, otherTl, otherExec, otherWork };
}

async function create(raw: Record<string, unknown>) {
  const { createTask } = await import("@/server/tasks/create");
  return createTask({ title: "Festive reel scripts", allocatedMinutes: 60, ...raw });
}

describe("Admin add-task: team first, the Team Leader decides (ADR 0008)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  it("requires a team, and a work type of that team for WORK tasks (not for meetings)", async () => {
    const s = await seed();
    session.set(s.admin);
    const noTeam = await create({ clientId: s.client.id, tagIds: [s.work.id] });
    expect(noTeam).toEqual({ ok: false, error: "Pick a team in the green area" });
    const noWork = await create({ clientId: s.client.id, teamIds: [s.team.id] });
    expect(noWork).toEqual({ ok: false, error: "Pick a work type in the green area" });
    const wrongWork = await create({ clientId: s.client.id, teamIds: [s.team.id], tagIds: [s.otherWork.id] });
    expect(wrongWork).toEqual({ ok: false, error: "Pick a work type in the green area" });
    const meeting = await create({ type: "MEETING", clientId: s.client.id, teamIds: [s.team.id] });
    expect(meeting.ok).toBe(true);
    expect(await testDb.task.count({ where: { type: "WORK" } })).toBe(0);
  });

  it("assigns the team's Team Leader, stores the preferences and the work type, notifies the TL", async () => {
    const s = await seed();
    session.set(s.admin);
    const res = await create({ clientId: s.client.id, teamIds: [s.team.id], tagIds: [s.work.id], preferredAssigneeIds: [s.exec2.id] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = await testDb.task.findUniqueOrThrow({ where: { id: res.data.taskId }, include: { assignees: true, teams: true, tags: true } });
    expect(t.assignees.map((a) => a.userId)).toEqual([s.tl.id]);
    expect(t.preferredAssigneeIds).toEqual([s.exec2.id]);
    expect(t.teams.map((x) => x.teamId)).toEqual([s.team.id]);
    expect(t.tags.map((x) => x.workTypeId)).toEqual([s.work.id]);
    const notes = await testDb.notification.findMany({ where: { taskId: t.id } });
    expect(notes.map((n) => [n.userId, n.title])).toEqual([[s.tl.id, "New task from Admin: Festive reel scripts · prefers Arjun — assign it from the task"]]);
  });

  it("without preferences the TL hears a plain 'New task from …'", async () => {
    const s = await seed();
    session.set(s.admin);
    const res = await create({ clientId: s.client.id, teamIds: [s.team.id], tagIds: [s.work.id] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const notes = await testDb.notification.findMany({ where: { taskId: res.data.taskId } });
    expect(notes.map((n) => n.title)).toEqual(["New task from Admin: Festive reel scripts"]);
  });

  it("rejects preferences outside the chosen team and teams without a Team Leader", async () => {
    const s = await seed();
    session.set(s.admin);
    const outside = await create({ clientId: s.client.id, teamIds: [s.team.id], tagIds: [s.work.id], preferredAssigneeIds: [s.otherExec.id] });
    expect(outside).toEqual({ ok: false, error: "Preferred executives must be executives of the chosen team" });
    const notExec = await create({ clientId: s.client.id, teamIds: [s.team.id], tagIds: [s.work.id], preferredAssigneeIds: [s.tl.id] });
    expect(notExec.ok).toBe(false);
    const empty = await testDb.team.create({ data: { name: "Video" } });
    const legacy = await anyTeamWorkType();
    const leaderless = await create({ clientId: s.client.id, teamIds: [empty.id], tagIds: [legacy.id] });
    expect(leaderless).toEqual({ ok: false, error: "That team has no Team Leader yet (Menu → Add teamleader)" });
    expect(await testDb.task.count()).toBe(0);
  });

  it("only Admin may set preferences", async () => {
    const s = await seed();
    session.set(s.tl);
    const res = await create({ clientId: s.client.id, assigneeIds: [s.exec.id], tagIds: [s.work.id], preferredAssigneeIds: [s.exec2.id] });
    expect(res.ok).toBe(false);
  });

  it("a legacy work type with no teams is available to every team", async () => {
    const s = await seed();
    const legacy = await anyTeamWorkType();
    session.set(s.admin);
    expect((await create({ clientId: s.client.id, teamIds: [s.other.id], tagIds: [legacy.id] })).ok).toBe(true);
    session.set(s.tl);
    expect((await create({ clientId: s.client.id, assigneeIds: [s.exec.id], tagIds: [legacy.id] })).ok).toBe(true);
    // …while a TL cannot use another team's work type
    expect((await create({ clientId: s.client.id, assigneeIds: [s.exec.id], tagIds: [s.otherWork.id] })).ok).toBe(false);
  });

  it("dashboard rows carry preferredAssigneeIds and the work type id; people carry specialities", async () => {
    const s = await seed();
    session.set(s.admin);
    const res = await create({ clientId: s.client.id, teamIds: [s.team.id], tagIds: [s.work.id], preferredAssigneeIds: [s.exec2.id] });
    expect(res.ok).toBe(true);
    const { dashboardData, getTaskRow } = await import("@/server/tasks/queries");
    const tlUser = { id: s.tl.id, role: "TEAM_LEADER" as const, teamId: s.team.id, teamLeaderId: null };
    const data = await dashboardData(tlUser);
    const row = data.tasks.find((t) => res.ok && t.id === res.data.taskId);
    expect(row?.preferredAssigneeIds).toEqual([s.exec2.id]);
    expect(row?.workTypeId).toBe(s.work.id);
    expect(data.people.find((p) => p.id === s.exec2.id)?.specialityIds).toEqual([s.work.id]);
    expect(data.workTypes.find((w) => w.id === s.work.id)?.teamIds).toEqual([s.team.id]);
    if (res.ok) expect((await getTaskRow(tlUser, res.data.taskId))?.preferredAssigneeIds).toEqual([s.exec2.id]);
    // Executive's green row 2 lists only their team's work types
    const execData = await dashboardData({ id: s.exec.id, role: "EXECUTIVE", teamId: s.team.id, teamLeaderId: s.tl.id });
    expect(execData.row2.map((r) => r.label)).toEqual(["Reels"]);
  });

  it("header inventory: Admin may scope it to preferred / team executives", async () => {
    const s = await seed();
    const tomorrowIst = formatInTimeZone(addDays(new Date(), 1), "Asia/Kolkata", "yyyy-MM-dd");
    const start = fromZonedTime(`${tomorrowIst}T10:30:00`, "Asia/Kolkata");
    await testDb.task.create({
      data: { title: "t", clientId: s.client.id, createdById: s.tl.id, allocatedMinutes: 60, scheduledStart: start, scheduledEnd: new Date(start.getTime() + 3600_000), assignees: { create: [{ userId: s.exec2.id }] } },
    });
    const { addTaskInventory } = await import("@/server/tasks/create");
    session.set(s.admin);
    const pref = await addTaskInventory([s.exec2.id]);
    expect(pref.ok && pref.data.tomorrow.count).toBe(1);
    const other = await addTaskInventory([s.otherExec.id]);
    expect(other.ok && other.data.tomorrow.count).toBe(0);
    session.set(s.tl);
    expect((await addTaskInventory([s.otherExec.id])).ok).toBe(false);
  });
});

describe("assignExecutives (long-press → Assign executive)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(150);
  });

  async function adminTask(s: Awaited<ReturnType<typeof seed>>) {
    session.set(s.admin);
    const res = await create({ clientId: s.client.id, teamIds: [s.team.id], tagIds: [s.work.id], preferredAssigneeIds: [s.exec2.id] });
    if (!res.ok) throw new Error(res.error);
    await settle(50);
    return res.data.taskId;
  }

  it("TL assigns own team's executives: assignees replaced, preferences kept, new assignees notified, Google sync queued", async () => {
    const s = await seed();
    const id = await adminTask(s);
    session.set({ ...s.tl, name: "Rishi Sharma" });
    const { assignExecutives } = await import("@/server/tasks/manage");
    const res = await assignExecutives(id, [s.exec2.id, s.tl.id]);
    expect(res).toEqual({ ok: true, data: { assigneeIds: [s.exec2.id, s.tl.id] } });
    const t = await loadTask(id);
    expect(t.assignees.map((a) => a.userId).sort()).toEqual([s.exec2.id, s.tl.id].sort());
    expect(t.preferredAssigneeIds).toEqual([s.exec2.id]);
    expect(t.assignedById).toBe(s.tl.id);
    const notes = await testDb.notification.findMany({ where: { taskId: id, userId: s.exec2.id } });
    expect(notes.map((n) => n.title)).toEqual(["New task from Rishi: Festive reel scripts"]);
    expect(await testDb.notification.count({ where: { taskId: id, userId: s.tl.id, title: { startsWith: "New task from Rishi" } } })).toBe(0);
    const kinds = (await testDb.integrationJob.findMany({ where: { taskId: id } })).map((j) => j.kind);
    expect(kinds).toEqual(expect.arrayContaining(["CALENDAR_UPDATE", "DRIVE_SHARE", "CHAT_MEMBERS"]));
    expect(await testDb.auditLog.count({ where: { entityId: id, action: "task.assignExecutives" } })).toBe(1);
  });

  it("Admin may assign on any task", async () => {
    const s = await seed();
    const id = await adminTask(s);
    session.set(s.admin);
    const { assignExecutives } = await import("@/server/tasks/manage");
    expect((await assignExecutives(id, [s.exec.id])).ok).toBe(true);
    expect((await loadTask(id)).assignees.map((a) => a.userId)).toEqual([s.exec.id]);
  });

  it("TL of another team is forbidden; a TL cannot pick someone outside the team", async () => {
    const s = await seed();
    const id = await adminTask(s);
    const { assignExecutives } = await import("@/server/tasks/manage");
    session.set(s.otherTl);
    const foreign = await assignExecutives(id, [s.otherExec.id]);
    expect(foreign).toEqual({ ok: false, error: "You can only assign tasks of your own team" });
    session.set(s.tl);
    const outsider = await assignExecutives(id, [s.otherExec.id]);
    expect(outsider.ok).toBe(false);
    if (!outsider.ok) expect(outsider.error).toMatch(/team/);
    expect((await loadTask(id)).assignees.map((a) => a.userId)).toEqual([s.tl.id]);
  });

  it("executives cannot assign; empty picks and completed tasks are rejected", async () => {
    const s = await seed();
    const id = await adminTask(s);
    const { assignExecutives } = await import("@/server/tasks/manage");
    session.set(s.exec);
    expect((await assignExecutives(id, [s.exec.id])).ok).toBe(false);
    session.set(s.tl);
    expect((await assignExecutives(id, [])).ok).toBe(false);
    await testDb.task.update({ where: { id }, data: { status: "COMPLETED" } });
    expect((await assignExecutives(id, [s.exec.id])).ok).toBe(false);
  });
});
