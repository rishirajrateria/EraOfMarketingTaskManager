import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { allKitFiles, clientHiddenFiles, clientShareTargets } from "@/server/clients/kit-client-share";
import { ensureCompanySettings } from "../../prisma/seed-company";

/** ADR 0020: the client is shared ONLY on Brand kit, the Credentials sheet, Reports and Final work. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

describe("client share targets (pure)", () => {
  const ids = { kitFolderId: "root", kitBrandId: "brand", kitCredentialsId: "creds", kitSheetId: "sheet", kitWorkId: "work", kitReportsId: "reports", kitFinalId: "final" };
  it("lists the four client-facing items with their roles; root, Credentials folder and Work are hidden", () => {
    expect(clientShareTargets(ids).map((t) => [t.key, t.fileId, t.role])).toEqual([
      ["brand", "brand", "writer"],
      ["sheet", "sheet", "writer"],
      ["reports", "reports", "reader"],
      ["final", "final", "reader"],
    ]);
    expect(clientHiddenFiles(ids)).toEqual(["root", "creds", "work"]);
    expect(allKitFiles(ids).sort()).toEqual(["brand", "creds", "final", "reports", "root", "sheet", "work"]);
    expect(clientShareTargets({ kitFolderId: "root" })).toEqual([]);
  });
});

describe("client Drive sharing (mock Drive log)", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { businessName: "Repo Media LLP", email: "Asha@Repo.test" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
    (await import("@/google/drive-share")).resetMockSharing();
  });

  const shares = async () => (await import("@/google/drive-share")).mockDriveShares();
  const create = async () => {
    const r = await (await import("@/server/clients/kit")).createClientKit(seed.client.id);
    if (!r.ok) throw new Error(r.error);
    return { res: r.data, c: await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } }) };
  };

  it("shares the client on exactly the four client-facing items, never the root, Credentials folder or Work", async () => {
    const { c, res } = await create();
    expect(res.sharedWith).toBe("asha@repo.test");
    const got = (await shares()).map((s) => [s.fileId, s.email, s.role]).sort();
    expect(got).toEqual(
      [
        [c.kitBrandId, "asha@repo.test", "writer"],
        [c.kitSheetId, "asha@repo.test", "writer"],
        [c.kitReportsId, "asha@repo.test", "reader"],
        [c.kitFinalId, "asha@repo.test", "reader"],
      ].sort(),
    );
    const sharedFiles = new Set((await shares()).map((s) => s.fileId));
    for (const hidden of [c.kitFolderId, c.kitCredentialsId, c.kitWorkId]) expect(sharedFiles.has(hidden!)).toBe(false);
  });

  it("Fix sharing repairs a legacy kit: removes the client from the root and Work, adds the client-facing folders, creates Final work", async () => {
    const { c } = await create();
    const { addPeople, resetMockSharing } = await import("@/google/drive-share");
    // simulate the old behaviour: Editor on the whole kit folder and on Work, no Final work folder
    resetMockSharing();
    await addPeople(c.kitFolderId!, ["asha@repo.test"], "writer", { notify: false, owner: "admin@test.local" });
    await addPeople(c.kitWorkId!, ["asha@repo.test"], "writer", { notify: false, owner: "admin@test.local" });
    await testDb.client.update({ where: { id: seed.client.id }, data: { kitFinalId: null, kitSharedWith: "asha@repo.test" } });
    const { hasKit } = await import("@/server/clients/kit-paths");
    expect(hasKit(await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } }))).toBe(false);

    const { fixClientKitSharing } = await import("@/server/clients/kit");
    const r = await fixClientKitSharing(seed.client.id);
    if (!r.ok) throw new Error(r.error);
    expect(r.data.created).toEqual(["Final work"]);
    expect(r.data.revoked).toBe(2);
    const after = await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } });
    const files = (await shares()).map((s) => s.fileId);
    expect(files).not.toContain(c.kitFolderId);
    expect(files).not.toContain(c.kitWorkId);
    expect(new Set(files)).toEqual(new Set([after.kitBrandId, after.kitSheetId, after.kitReportsId, after.kitFinalId]));
    expect(hasKit(after)).toBe(true);
    // idempotent
    const again = await fixClientKitSharing(seed.client.id);
    expect(again.ok && again.data.revoked).toBe(0);
    expect((await shares()).length).toBe(4);
    const { fixClientKitSharing: f } = await import("@/server/clients/kit");
    session.set({ id: seed.tl.id, role: "TEAM_LEADER" });
    expect((await f(seed.client.id)).ok).toBe(false);
  });

  it("a changed client email revokes the old address everywhere and shares the new one", async () => {
    const { c } = await create();
    const { updateClient } = await import("@/server/admin/actions");
    const r = await updateClient({ id: seed.client.id, name: "Repo", email: "new@repo.test" });
    expect(r.ok).toBe(true);
    const list = await shares();
    expect(list.some((s) => s.email === "asha@repo.test")).toBe(false);
    expect(list.filter((s) => s.email === "new@repo.test").map((s) => s.fileId).sort()).toEqual([c.kitBrandId, c.kitSheetId, c.kitReportsId, c.kitFinalId].sort());
    expect((await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } })).kitSharedWith).toBe("new@repo.test");
    expect(await testDb.auditLog.count({ where: { action: "client.kit.sharing.sync", entityId: seed.client.id } })).toBe(1);
  });

  it("deactivating a client revokes all client access; reactivating re-shares", async () => {
    await create();
    const { setClientActive } = await import("@/server/admin/actions");
    expect((await setClientActive(seed.client.id, false)).ok).toBe(true);
    expect(await shares()).toEqual([]);
    expect((await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } })).kitSharedWith).toBeNull();
    expect((await setClientActive(seed.client.id, true)).ok).toBe(true);
    expect((await shares()).length).toBe(4);
  });

  it("only touches the client's own access: staff added to a folder keep theirs", async () => {
    const { c } = await create();
    const { addPeople } = await import("@/google/drive-share");
    await addPeople(c.kitWorkId!, ["tl@test.local"], "writer", { notify: false, owner: "admin@test.local" });
    const { setClientActive } = await import("@/server/admin/actions");
    await setClientActive(seed.client.id, false);
    expect(await shares()).toEqual([{ fileId: c.kitWorkId, email: "tl@test.local", role: "writer" }]);
  });
});

describe("seed keeps existing company settings", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("creates demo defaults only when absent and never overwrites an edited row", async () => {
    expect(await ensureCompanySettings(testDb)).toBe(true);
    expect((await testDb.companySettings.findUniqueOrThrow({ where: { id: "default" } })).companyName).toBe("The Era Of Marketing");
    await testDb.companySettings.update({ where: { id: "default" }, data: { companyName: "Owner Edited", bankAccountNumber: "999" } });
    expect(await ensureCompanySettings(testDb)).toBe(false);
    const s = await testDb.companySettings.findUniqueOrThrow({ where: { id: "default" } });
    expect([s.companyName, s.bankAccountNumber]).toEqual(["Owner Edited", "999"]);
  });
});
