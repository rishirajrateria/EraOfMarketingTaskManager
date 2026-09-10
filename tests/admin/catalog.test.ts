import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();

async function load() {
  return import("@/server/admin/actions");
}

describe("admin teams / clients / work types", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a team with a leader and audits it", async () => {
    const { admin, tl, exec } = await seedBasics();
    session.set(admin);
    const actions = await load();

    const bad = await actions.createTeam({ name: "Video", leaderId: exec.id });
    expect(bad.ok).toBe(false);

    const res = await actions.createTeam({ name: "Video", colour: "#ff0000", leaderId: tl.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const team = await testDb.team.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(team).toMatchObject({ name: "Video", colour: "#ff0000", leaderId: tl.id, active: true });

    const dup = await actions.createTeam({ name: "Video" });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toMatch(/already exists/);

    const off = await actions.setTeamActive(team.id, false);
    expect(off.ok).toBe(true);
    expect((await testDb.team.findUniqueOrThrow({ where: { id: team.id } })).active).toBe(false);
    expect(await testDb.auditLog.count({ where: { entityType: "Team", entityId: team.id } })).toBe(2);
  });

  it("rejects team changes from non-admins", async () => {
    const { tl } = await seedBasics();
    session.set(tl);
    const actions = await load();
    expect((await actions.createTeam({ name: "Nope" })).ok).toBe(false);
  });

  it("creates and updates a client", async () => {
    const { admin } = await seedBasics();
    session.set(admin);
    const actions = await load();

    const res = await actions.createClient({ name: "Robam", contact: "Mr Lee", email: "Lee@Robam.com", gstNumber: "27AAAAA0000A1Z5", address: "Pune" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const client = await testDb.client.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(client).toMatchObject({ name: "Robam", contact: "Mr Lee", email: "lee@robam.com", visibleInFilters: false, active: true });

    const badEmail = await actions.createClient({ name: "Other", email: "not-an-email" });
    expect(badEmail.ok).toBe(false);

    const upd = await actions.updateClient({ id: client.id, name: "Robam India", email: "", contact: "" });
    expect(upd.ok).toBe(true);
    const after = await testDb.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(after.name).toBe("Robam India");
    expect(after.email).toBeNull();
    expect(after.contact).toBeNull();
  });

  it("creates a work type and toggles it", async () => {
    const { admin } = await seedBasics();
    session.set(admin);
    const actions = await load();
    const res = await actions.createWorkType({ name: "Pharma bag", colour: "#10b981" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await actions.createWorkType({ name: "Pharma bag" })).ok).toBe(false);
    expect((await actions.createWorkType({ name: "Bad colour", colour: "red" })).ok).toBe(false);
    const off = await actions.setWorkTypeActive(res.data.id, false);
    expect(off.ok).toBe(true);
    const wt = await testDb.workType.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(wt).toMatchObject({ name: "Pharma bag", colour: "#10b981", active: false });
  });
});
