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
    expect(client).toMatchObject({ name: "Robam", contact: "Mr Lee", email: "lee@robam.com", visibleInFilters: false, active: true, country: "IN", stateCode: "27", stateName: "Maharashtra", workOnHold: false });

    const badEmail = await actions.createClient({ name: "Other", email: "not-an-email" });
    expect(badEmail.ok).toBe(false);

    const upd = await actions.updateClient({ id: client.id, name: "Robam India", email: "", contact: "" });
    expect(upd.ok).toBe(true);
    const after = await testDb.client.findUniqueOrThrow({ where: { id: client.id } });
    expect(after.name).toBe("Robam India");
    expect(after.email).toBeNull();
    expect(after.contact).toBeNull();
    expect(after.stateCode).toBeNull(); // no GSTIN any more → state cleared
  });

  it("client billing fields: country, state from GSTIN (or by hand), phone, WhatsApp in E.164, TDS %", async () => {
    const { admin } = await seedBasics();
    session.set(admin);
    const actions = await load();
    const res = await actions.createClient({ name: "Acme US", country: "us", phone: "+1 212 555 0100", whatsapp: "+1 (212) 555-0100", tdsPercent: 10 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const c = await testDb.client.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(c).toMatchObject({ country: "US", phone: "+1 212 555 0100", whatsapp: "+12125550100", stateCode: null });
    expect(c.tdsPercent?.toNumber()).toBe(10);

    // GSTIN wins over a typed state; a typed state is kept for unregistered clients and its name is looked up
    const typed = await actions.createClient({ name: "Local shop", stateCode: "29", whatsapp: "9876543210" });
    expect(typed.ok).toBe(true);
    if (!typed.ok) return;
    expect(await testDb.client.findUniqueOrThrow({ where: { id: typed.data.id } })).toMatchObject({ stateCode: "29", stateName: "Karnataka", whatsapp: "+919876543210" });
    const upd = await actions.updateClient({ id: typed.data.id, name: "Local shop", stateCode: "29", gstNumber: "07aaaaa0000a1z5" });
    expect(upd.ok).toBe(true);
    expect(await testDb.client.findUniqueOrThrow({ where: { id: typed.data.id } })).toMatchObject({ gstNumber: "07AAAAA0000A1Z5", stateCode: "07", stateName: "Delhi" });

    expect((await actions.createClient({ name: "Bad state", stateCode: "99x" })).ok).toBe(false);
    expect((await actions.createClient({ name: "Bad wa", whatsapp: "12" })).ok).toBe(false);
    expect((await actions.createClient({ name: "Bad country", country: "USA" })).ok).toBe(false);
    const { listClients } = await import("@/server/admin/queries");
    const rows = await listClients();
    expect(rows.find((r) => r.name === "Acme US")).toMatchObject({ country: "US", tdsPercent: 10, whatsapp: "+12125550100", workOnHold: false });
  });

  it("creates a work type and toggles it", async () => {
    const { admin, team } = await seedBasics();
    session.set(admin);
    const actions = await load();
    const res = await actions.createWorkType({ name: "Pharma bag", colour: "#10b981", teamIds: [team.id] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await actions.createWorkType({ name: "Pharma bag", teamIds: [team.id] })).ok).toBe(false);
    expect((await actions.createWorkType({ name: "Bad colour", colour: "red", teamIds: [team.id] })).ok).toBe(false);
    const off = await actions.setWorkTypeActive(res.data.id, false);
    expect(off.ok).toBe(true);
    const wt = await testDb.workType.findUniqueOrThrow({ where: { id: res.data.id } });
    expect(wt).toMatchObject({ name: "Pharma bag", colour: "#10b981", active: false });
  });
});
