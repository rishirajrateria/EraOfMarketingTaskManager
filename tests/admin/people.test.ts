import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

process.env.GOOGLE_WORKSPACE_DOMAIN = "test.local";
const session = mockSession();

async function load() {
  return import("@/server/admin/actions");
}

describe("admin people actions", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects non-admin callers", async () => {
    const { exec } = await seedBasics();
    session.set(exec);
    const actions = await load();
    const res = await actions.createUser({ email: "new@test.local", name: "New", role: "EXECUTIVE" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Requires role ADMIN/);
    expect(await testDb.user.count({ where: { email: "new@test.local" } })).toBe(0);
  });

  it("rejects unauthenticated callers", async () => {
    session.clear();
    const actions = await load();
    const res = await actions.createUser({ email: "new@test.local", name: "New", role: "HR" });
    expect(res.ok).toBe(false);
  });

  it("requires a reporting team leader for executives", async () => {
    const { admin, tl, team } = await seedBasics();
    session.set(admin);
    const actions = await load();

    const missing = await actions.createUser({ email: "e2@test.local", name: "Exec Two", role: "EXECUTIVE", teamId: team.id });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/Team Leader/);

    const wrongRole = await actions.createUser({ email: "e2@test.local", name: "Exec Two", role: "EXECUTIVE", teamLeaderId: admin.id });
    expect(wrongRole.ok).toBe(false);

    const res = await actions.createUser({
      email: "E2@Test.Local",
      name: "Exec Two",
      role: "EXECUTIVE",
      teamLeaderId: tl.id,
      dailyCapacityMinutes: 360,
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const created = await testDb.user.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(created.email).toBe("e2@test.local");
    expect(created.role).toBe("EXECUTIVE");
    expect(created.teamLeaderId).toBe(tl.id);
    expect(created.teamId).toBe(team.id); // inherited from the leader
    expect(created.dailyCapacityMinutes).toBe(360);
    expect(created.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(created.active).toBe(true);
    expect(created.activatedAt).toBeNull();

    const log = await testDb.auditLog.findFirst({ where: { entityType: "User", entityId: created.id, action: "user.create" } });
    expect(log?.actorId).toBe(admin.id);

    const { sentMailLog } = await import("@/google/gmail");
    expect(sentMailLog.some((m) => m.to === "e2@test.local")).toBe(true);
  });

  it("enforces the workspace domain for every role and reports duplicate emails", async () => {
    const { admin } = await seedBasics();
    session.set(admin);
    const actions = await load();
    const foreign = await actions.createUser({ email: "x@gmail.com", name: "X", role: "HR" });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error).toMatch(/@test.local/);
    const first = await actions.createUser({ email: "hr2@test.local", name: "HR Two", role: "HR" });
    expect(first.ok).toBe(true);
    const dup = await actions.createUser({ email: "HR2@test.local", name: "HR Two", role: "HR" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/already exists/);
  });

  it("rejects the parked CA role on create and update (ADR 0004)", async () => {
    const { admin, hr } = await seedBasics();
    session.set(admin);
    const actions = await load();
    const create = await actions.createUser({ email: "accountant@test.local", name: "CA", role: "CA" });
    expect(create.ok).toBe(false);
    if (!create.ok) expect(create.error).toMatch(/CA access is not available/);
    expect(await testDb.user.count({ where: { email: "accountant@test.local" } })).toBe(0);

    const update = await actions.updateUser({ id: hr.id, email: hr.email, name: hr.name, role: "CA" });
    expect(update.ok).toBe(false);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: hr.id } })).role).toBe("HR");
  });

  it("updates a user and moves them between roles", async () => {
    const { admin, exec, tl } = await seedBasics();
    session.set(admin);
    const actions = await load();
    // one Team Leader per team (ADR 0008): the promoted executive leads a second team
    const video = await testDb.team.create({ data: { name: "Video" } });
    const res = await actions.updateUser({ id: exec.id, email: exec.email, name: "Arush K", role: "TEAM_LEADER", teamId: video.id, teamLeaderId: tl.id });
    expect(res.ok).toBe(true);
    const after = await testDb.user.findUniqueOrThrow({ where: { id: exec.id } });
    expect(after.name).toBe("Arush K");
    expect(after.role).toBe("TEAM_LEADER");
    expect(after.teamLeaderId).toBeNull(); // only executives keep a reporting leader
    expect((await testDb.team.findUniqueOrThrow({ where: { id: video.id } })).leaderId).toBe(exec.id);

    const self = await actions.updateUser({ id: admin.id, email: admin.email, name: admin.name, role: "HR" });
    expect(self.ok).toBe(false);
  });

  it("deactivates and reactivates a user", async () => {
    const { admin, exec } = await seedBasics();
    await testDb.session.create({ data: { sessionToken: "tok", userId: exec.id, expires: new Date(Date.now() + 86_400_000) } });
    session.set(admin);
    const actions = await load();

    const off = await actions.deactivateUser(exec.id);
    expect(off.ok).toBe(true);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: exec.id } })).active).toBe(false);
    expect(await testDb.session.count({ where: { userId: exec.id } })).toBe(0);

    const on = await actions.reactivateUser(exec.id);
    expect(on.ok).toBe(true);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: exec.id } })).active).toBe(true);

    const self = await actions.deactivateUser(admin.id);
    expect(self.ok).toBe(false);

    const actions2 = await testDb.auditLog.findMany({ where: { entityId: exec.id }, select: { action: true } });
    expect(actions2.map((a) => a.action).sort()).toEqual(["user.deactivate", "user.reactivate"]);
  });

  it("stores a mobile for Call / WhatsApp in E.164; '' clears it, leaving it out keeps it (ADR 0017)", async () => {
    const { admin, tl, team } = await seedBasics();
    session.set(admin);
    const actions = await load();
    const bad = await actions.createUser({ email: "p1@test.local", name: "Phone One", role: "HR", phone: "12ab" });
    expect(bad.ok).toBe(false);
    const short = await actions.createUser({ email: "p1@test.local", name: "Phone One", role: "HR", phone: "+44 1234 56" });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error).toMatch(/at least 10 digits/);
    const ok = await actions.createUser({ email: "p1@test.local", name: "Phone One", role: "EXECUTIVE", teamId: team.id, teamLeaderId: tl.id, phone: "98300 11122" });
    if (!ok.ok) throw new Error(ok.error);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: ok.data.id } })).phone).toBe("+919830011122");
    const base = { id: ok.data.id, email: "p1@test.local", name: "Phone One", role: "EXECUTIVE" as const, teamId: team.id, teamLeaderId: tl.id };
    expect((await actions.updateUser(base)).ok).toBe(true);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: ok.data.id } })).phone).toBe("+919830011122");
    expect((await actions.updateUser({ ...base, phone: "" })).ok).toBe(true);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: ok.data.id } })).phone).toBeNull();
  });
});
