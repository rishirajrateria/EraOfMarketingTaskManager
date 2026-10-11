import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

/** Dashboard "+" → Client kit: the picker lists active clients with their kit state; Admin only. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

describe("kitPickerClients", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
  });

  it("is admin only", async () => {
    const { kitPickerClients } = await import("@/server/shell/kit-picker");
    session.set({ id: seed.exec.id, role: "EXECUTIVE" });
    expect((await kitPickerClients()).ok).toBe(false);
    session.set({ id: seed.tl.id, role: "TEAM_LEADER" });
    expect((await kitPickerClients()).ok).toBe(false);
  });

  it("returns active clients by name with ready / partial kit flags", async () => {
    const { kitPickerClients } = await import("@/server/shell/kit-picker");
    const ids = { kitFolderId: "f", kitBrandId: "b", kitCredentialsId: "c", kitSheetId: "s", kitWorkId: "w", kitReportsId: "r" };
    await testDb.client.create({ data: { name: "Acme", businessName: "Acme Pvt Ltd", ...ids } });
    await testDb.client.create({ data: { name: "Bolt", kitFolderId: "f2" } });
    await testDb.client.create({ data: { name: "Gone", active: false } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    const r = await kitPickerClients();
    if (!r.ok) throw new Error(r.error);
    expect(r.data.map(({ name, ready, partial }) => ({ name, ready, partial }))).toEqual([
      { name: "Acme Pvt Ltd", ready: true, partial: false },
      { name: "Bolt", ready: false, partial: true },
      { name: "Repo", ready: false, partial: false },
    ]);
  });
});
