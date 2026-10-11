import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

process.env.GOOGLE_WORKSPACE_DOMAIN = "test.local";
const session = mockSession();
const load = () => import("@/server/admin/actions");

describe("Add Work: work types belong to teams (ADR 0008)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates, edits and removes a work type with its teams; at least one known team is required", async () => {
    const { admin, team } = await seedBasics();
    const seo = await testDb.team.create({ data: { name: "SEO" } });
    session.set(admin);
    const a = await load();

    const none = await a.createWorkType({ name: "Content", teamIds: [] });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toMatch(/Pick at least one team/);
    expect((await a.createWorkType({ name: "Content", teamIds: ["nope"] })).ok).toBe(false);

    const res = await a.createWorkType({ name: "Content", teamIds: [team.id, seo.id, seo.id] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const created = await testDb.workType.findUniqueOrThrow({ where: { id: res.data.id }, include: { teams: true } });
    expect(created.teams.map((t) => t.name).sort()).toEqual(["Graphic", "SEO"]);

    expect((await a.updateWorkType({ id: res.data.id, name: "Content writing", teamIds: [] })).ok).toBe(false);
    expect((await a.updateWorkType({ id: res.data.id, name: "Content writing", teamIds: [seo.id] })).ok).toBe(true);
    const edited = await testDb.workType.findUniqueOrThrow({ where: { id: res.data.id }, include: { teams: true } });
    expect(edited.name).toBe("Content writing");
    expect(edited.teams.map((t) => t.id)).toEqual([seo.id]);

    const { listWorkTypes, listTeams } = await import("@/server/admin/queries");
    expect((await listWorkTypes()).find((w) => w.id === res.data.id)?.teamIds).toEqual([seo.id]);
    expect((await listTeams()).find((t) => t.id === seo.id)?.workTypes.map((w) => w.name)).toEqual(["Content writing"]);

    // Remove: hard delete when unused…
    const gone = await a.removeWorkType(res.data.id);
    expect(gone).toEqual({ ok: true, data: { id: res.data.id, deleted: true } });
    expect(await testDb.workType.count({ where: { id: res.data.id } })).toBe(0);
  });

  it("Remove keeps a work type that tasks use (deactivated)", async () => {
    const { admin, team, tl, client } = await seedBasics();
    const wt = await testDb.workType.create({ data: { name: "Logo", teams: { connect: [{ id: team.id }] } } });
    await testDb.task.create({ data: { title: "t", clientId: client.id, createdById: admin.id, assignees: { create: [{ userId: tl.id }] }, tags: { create: [{ workTypeId: wt.id }] } } });
    session.set(admin);
    const a = await load();
    expect(await a.removeWorkType(wt.id)).toEqual({ ok: true, data: { id: wt.id, deleted: false } });
    expect((await testDb.workType.findUniqueOrThrow({ where: { id: wt.id } })).active).toBe(false);
    expect(await testDb.taskTag.count({ where: { workTypeId: wt.id } })).toBe(1);
  });

  it("non-admins cannot manage work types", async () => {
    const { tl, team } = await seedBasics();
    session.set(tl);
    const a = await load();
    expect((await a.createWorkType({ name: "Reels", teamIds: [team.id] })).ok).toBe(false);
  });
});

describe("Add executive / team leader: specialities and one Team Leader per team", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("specialities must be work types of the person's team (legacy no-team work types allowed)", async () => {
    const { admin, team, tl } = await seedBasics();
    const seo = await testDb.team.create({ data: { name: "SEO" } });
    const reels = await testDb.workType.create({ data: { name: "Reels", teams: { connect: [{ id: team.id }] } } });
    const keywords = await testDb.workType.create({ data: { name: "Keyword research", teams: { connect: [{ id: seo.id }] } } });
    const legacy = await testDb.workType.create({ data: { name: "Reporting" } });
    session.set(admin);
    const a = await load();

    const bad = await a.createUser({ email: "x@test.local", name: "X", role: "EXECUTIVE", teamLeaderId: tl.id, specialityIds: [keywords.id] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/work types of the person's team/);

    const ok = await a.createUser({ email: "x@test.local", name: "X", role: "EXECUTIVE", teamLeaderId: tl.id, specialityIds: [reels.id, legacy.id] });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const user = await testDb.user.findUniqueOrThrow({ where: { id: ok.data.id }, include: { specialities: true } });
    expect(user.specialities.map((w) => w.name).sort()).toEqual(["Reels", "Reporting"]);

    const { listPeople } = await import("@/server/admin/queries");
    expect((await listPeople()).find((p) => p.id === ok.data.id)?.specialities.map((w) => w.name)).toEqual(["Reels", "Reporting"]);

    // Edit replaces the set
    const upd = await a.updateUser({ id: user.id, email: user.email, name: user.name, role: "EXECUTIVE", teamLeaderId: tl.id, specialityIds: [reels.id] });
    expect(upd.ok).toBe(true);
    const after = await testDb.user.findUniqueOrThrow({ where: { id: user.id }, include: { specialities: true } });
    expect(after.specialities.map((w) => w.id)).toEqual([reels.id]);

    // HR / Admin never keep specialities
    const hr = await a.createUser({ email: "hr2@test.local", name: "HR2", role: "HR", specialityIds: [legacy.id] });
    expect(hr.ok).toBe(true);
    if (hr.ok) expect((await testDb.user.findUniqueOrThrow({ where: { id: hr.data.id }, include: { specialities: true } })).specialities).toEqual([]);
  });

  it("one Team Leader per team; Team.leaderId follows the Team Leader", async () => {
    const { admin, team } = await seedBasics();
    const video = await testDb.team.create({ data: { name: "Video" } });
    session.set(admin);
    const a = await load();

    const dup = await a.createUser({ email: "tl2@test.local", name: "TL Two", role: "TEAM_LEADER", teamId: team.id });
    expect(dup).toEqual({ ok: false, error: "Graphic already has a team leader" });

    const ok = await a.createUser({ email: "tl2@test.local", name: "TL Two", role: "TEAM_LEADER", teamId: video.id });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect((await testDb.team.findUniqueOrThrow({ where: { id: video.id } })).leaderId).toBe(ok.data.id);

    // Moving the leader into a team that already has one is refused…
    const move = await a.updateUser({ id: ok.data.id, email: "tl2@test.local", name: "TL Two", role: "TEAM_LEADER", teamId: team.id });
    expect(move).toEqual({ ok: false, error: "Graphic already has a team leader" });
    // …demoting them clears the team's leader
    const demote = await a.updateUser({ id: ok.data.id, email: "tl2@test.local", name: "TL Two", role: "HR", teamId: video.id });
    expect(demote.ok).toBe(true);
    expect((await testDb.team.findUniqueOrThrow({ where: { id: video.id } })).leaderId).toBeNull();
  });

  it("picking a leader in the team form moves them into that team", async () => {
    const { admin, team, tl } = await seedBasics();
    const video = await testDb.team.create({ data: { name: "Video" } });
    session.set(admin);
    const a = await load();
    expect((await a.updateTeam({ id: video.id, name: "Video", leaderId: tl.id })).ok).toBe(true);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: tl.id } })).teamId).toBe(video.id);
    expect((await testDb.team.findUniqueOrThrow({ where: { id: video.id } })).leaderId).toBe(tl.id);
    expect((await testDb.team.findUniqueOrThrow({ where: { id: team.id } })).leaderId).toBeNull();
  });
});
