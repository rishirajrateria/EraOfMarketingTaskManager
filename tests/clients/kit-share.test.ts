import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import type { DrivePermission } from "@/google/drive-share";
import { kitShareScopes, scopeUrl, splitAccess, teamSuggestions } from "@/server/clients/kit-share-scopes";

/** ADR 0014 "Sharing a kit": whole kit or one part, per-person access, team suggestions, access via the whole kit. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

const perm = (o: Partial<DrivePermission> & { id: string }): DrivePermission => ({ type: "user", role: "reader", emailAddress: null, displayName: null, domain: null, inherited: null, ...o });
const FOLDERS = ["Brand kit", "Credentials", "Work", "Reports"] as const;

describe("client kit sharing — pure helpers", () => {
  it("lists the whole kit and the parts that exist; Credentials shares the sheet", () => {
    expect(kitShareScopes({ kitFolderId: null }, FOLDERS, "Repo")).toEqual([]);
    const all = kitShareScopes({ kitFolderId: "k", kitBrandId: "b", kitCredentialsId: "c", kitSheetId: "s", kitWorkId: "w", kitReportsId: "r" }, FOLDERS, "Repo");
    expect(all.map((s) => [s.key, s.name, s.label, s.fileId])).toEqual([
      ["kit", "Whole kit", "Client kit › Repo", "k"],
      ["brand", "Brand kit", "Repo › Brand kit", "b"],
      ["sheet", "Credentials sheet", "Repo › Credentials sheet", "s"],
      ["work", "Work", "Repo › Work", "w"],
      ["reports", "Reports", "Repo › Reports", "r"],
    ]);
    expect(scopeUrl(all[2])).toBe("https://docs.google.com/spreadsheets/d/s/edit");
    expect(scopeUrl(all[3])).toBe("https://drive.google.com/drive/folders/w");
    expect(kitShareScopes({ kitFolderId: "k", kitWorkId: "w" }, ["Logos", "Logins", "Deliverables", "Monthly"], "Repo").map((s) => s.name)).toEqual(["Whole kit", "Deliverables"]);
  });

  it("splits a part's access into direct and via the whole kit", () => {
    const owner = perm({ id: "o", role: "owner", emailAddress: "me@x.in" });
    const kit = [owner, perm({ id: "1", role: "writer", emailAddress: "tl@x.in" }), perm({ id: "2", role: "reader", emailAddress: "ex@x.in" }), perm({ id: "anyone", type: "anyone", role: "reader" })];
    // whole kit: everything is direct
    expect(splitAccess(kit, null)).toMatchObject({ inherited: [], inheritedLink: null, link: { id: "anyone" } });
    // mock: the part only stores its own rows
    const mock = splitAccess([owner, perm({ id: "9", role: "writer", emailAddress: "ex2@x.in", inherited: false })], kit);
    expect(mock.direct.map((p) => p.id)).toEqual(["o", "9"]);
    expect(mock.inherited.map((p) => p.id)).toEqual(["1", "2"]);
    expect(mock.inheritedLink).toBe("reader");
    // live My Drive: inherited rows are listed on the child without details → same role as the kit = via kit
    const live = splitAccess([owner, perm({ id: "1", role: "writer", emailAddress: "tl@x.in" }), perm({ id: "2", role: "writer", emailAddress: "ex@x.in" }), perm({ id: "anyone", type: "anyone", role: "reader" })], kit);
    expect(live.direct.map((p) => p.id)).toEqual(["o", "2"]); // ex was raised to Editor on this part
    expect(live.inherited.map((p) => p.id)).toEqual(["1"]);
    expect([live.link, live.inheritedLink]).toEqual([null, "reader"]);
    // Drive's own flag wins
    const flagged = splitAccess([perm({ id: "1", role: "writer", emailAddress: "tl@x.in", inherited: false })], kit);
    expect(flagged.direct.map((p) => p.id)).toEqual(["1"]);
  });

  it("suggests active Team leaders then Executives who don't have direct access yet", () => {
    const team = [
      { id: "a", name: "Zara Exec", email: "z@x.in", role: "EXECUTIVE" },
      { id: "b", name: "Rishi TL", email: "r@x.in", role: "TEAM_LEADER" },
      { id: "c", name: "Ann Exec", email: "a@x.in", role: "EXECUTIVE" },
      { id: "d", name: "Boss", email: "boss@x.in", role: "ADMIN" },
      { id: "e", name: "Hema", email: "h@x.in", role: "HR" },
    ];
    expect(teamSuggestions(team, []).map((u) => u.id)).toEqual(["b", "c", "a"]);
    expect(teamSuggestions(team, ["A@x.in", null, "r@x.in"]).map((u) => u.id)).toEqual(["a"]);
  });
});

describe("client kit sharing — actions", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { businessName: "Repo Media LLP", email: "asha@repo.test" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
    (await import("@/google/drive-share")).resetMockSharing();
  });

  const kit = async () => {
    const r = await (await import("@/server/clients/kit")).createClientKit(seed.client.id);
    expect(r.ok).toBe(true);
    return testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } });
  };

  it("is admin only", async () => {
    await kit();
    const a = await import("@/server/clients/kit-share");
    for (const role of ["TEAM_LEADER", "EXECUTIVE", "HR", "CA"] as const) {
      session.set({ id: seed.tl.id, role });
      expect((await a.getKitSharing(seed.client.id, { scope: "kit" })).ok).toBe(false);
      expect((await a.shareKit(seed.client.id, { scope: "kit", people: [{ email: "x@y.in", role: "writer" }] })).ok).toBe(false);
      expect((await a.changeKitShareRole(seed.client.id, { scope: "kit", permissionId: "perm_1", role: "reader" })).ok).toBe(false);
      expect((await a.removeKitShareAccess(seed.client.id, { scope: "kit", permissionId: "perm_1" })).ok).toBe(false);
      expect((await a.setKitGeneralAccess(seed.client.id, { scope: "kit", access: "anyone" })).ok).toBe(false);
    }
    expect(await testDb.auditLog.count({ where: { action: { startsWith: "client.kit.share" } } })).toBe(0);
  });

  it("validates the client, the scope and the people", async () => {
    const { getKitSharing, shareKit } = await import("@/server/clients/kit-share");
    expect(await getKitSharing(seed.client.id, { scope: "kit" })).toEqual({ ok: false, error: "Create the client kit first" });
    expect(await getKitSharing("missing", { scope: "kit" })).toEqual({ ok: false, error: "Client not found" });
    const c = await kit();
    for (const scope of ["credentials", "root", "", c.kitFolderId, undefined]) expect((await getKitSharing(seed.client.id, { scope })).ok).toBe(false);
    await testDb.client.update({ where: { id: seed.client.id }, data: { kitReportsId: null } });
    expect(await getKitSharing(seed.client.id, { scope: "reports" })).toEqual({ ok: false, error: "That part of the kit doesn't exist yet — tap Repair" });

    const bad = async (people: unknown) => {
      const r = await shareKit(seed.client.id, { scope: "work", people });
      expect(r.ok).toBe(false);
      return r.ok ? "" : r.error;
    };
    expect(await bad([])).toMatch(/at least one/);
    expect(await bad([{ email: "nope", role: "reader" }])).toMatch(/valid email/);
    expect(await bad([{ email: "a@b.in", role: "owner" }])).toMatch(/role/);
    expect(await bad([{ email: "a@b.in", role: "reader" }, { email: "A@b.in", role: "writer" }])).toMatch(/once/);
    expect(await bad(Array.from({ length: 26 }, (_, i) => ({ email: `p${i}@b.in`, role: "reader" })))).toMatch(/at most 25/);
    expect(await bad([{ email: "admin@test.local", role: "writer" }])).toMatch(/owns this kit/);
    expect(await testDb.auditLog.count({ where: { action: "client.kit.share.add" } })).toBe(0);
  });

  it("shares the whole kit with each person's own access and notifies with the message", async () => {
    const c = await kit();
    const { getKitSharing, shareKit } = await import("@/server/clients/kit-share");
    const before = await getKitSharing(seed.client.id, { scope: "kit" });
    if (!before.ok) throw new Error(before.error);
    expect(before.data).toMatchObject({ title: "Client kit › Repo Media LLP", url: `https://drive.google.com/drive/folders/${c.kitFolderId}`, owner: "admin@test.local" });
    expect(before.data.scopes.map((s) => s.name)).toEqual(["Whole kit", "Brand kit", "Credentials sheet", "Work", "Reports"]);
    expect(teamSuggestions(before.data.team, before.data.people.map((p) => p.email)).map((u) => u.email)).toEqual(["tl@test.local", "exec@test.local"]);

    const r = await shareKit(seed.client.id, {
      scope: "kit",
      people: [{ email: "tl@test.local", role: "writer" }, { email: "exec@test.local", role: "reader" }, { email: "Owner@Client.com", role: "commenter" }],
      notify: true,
      message: "Welcome aboard",
    });
    if (!r.ok) throw new Error(r.error);
    expect(r.data.added).toEqual([{ email: "tl@test.local", role: "writer" }, { email: "exec@test.local", role: "reader" }, { email: "owner@client.com", role: "commenter" }]);
    expect(r.data.sharing.people.map((p) => [p.email, p.role, p.inherited])).toEqual([
      ["admin@test.local", "owner", false],
      ["asha@repo.test", "writer", false],
      ["exec@test.local", "reader", false],
      ["owner@client.com", "commenter", false],
      ["tl@test.local", "writer", false],
    ]);
    const { mockShareNotifications } = await import("@/google/drive-share");
    expect(mockShareNotifications.map((n) => [n.fileId, n.to, n.role, n.message])).toEqual([
      [c.kitFolderId, "tl@test.local", "writer", "Welcome aboard"],
      [c.kitFolderId, "exec@test.local", "reader", "Welcome aboard"],
      [c.kitFolderId, "owner@client.com", "commenter", "Welcome aboard"],
    ]);
    expect(teamSuggestions(r.data.sharing.team, r.data.sharing.people.map((p) => p.email))).toEqual([]);
    const log = await testDb.auditLog.findFirstOrThrow({ where: { action: "client.kit.share.add", entityId: seed.client.id } });
    expect(log.after).toMatchObject({ scope: "kit", fileId: c.kitFolderId, notify: true });
  });

  it("shares one folder; whole-kit people show read-only on it; roles change and access is removed per folder", async () => {
    const c = await kit();
    const exec2 = await testDb.user.create({ data: { email: "exec2@test.local", name: "Meera Shah", role: "EXECUTIVE", teamId: seed.team.id, activatedAt: new Date() } });
    const a = await import("@/server/clients/kit-share");
    await a.shareKit(seed.client.id, { scope: "kit", people: [{ email: "tl@test.local", role: "writer" }, { email: "exec@test.local", role: "reader" }], notify: false });

    const work = await a.shareKit(seed.client.id, { scope: "work", people: [{ email: exec2.email, role: "writer" }], notify: false });
    if (!work.ok) throw new Error(work.error);
    const { listPermissions, mockShareNotifications } = await import("@/google/drive-share");
    expect(mockShareNotifications).toEqual([]);
    expect((await listPermissions(c.kitWorkId!)).map((p) => [p.emailAddress, p.role])).toEqual([["admin@test.local", "owner"], ["exec2@test.local", "writer"]]);
    expect((await listPermissions(c.kitFolderId!)).some((p) => p.emailAddress === exec2.email)).toBe(false);
    const s = work.data.sharing;
    expect(s).toMatchObject({ title: "Repo Media LLP › Work", name: "Work", inheritedLink: null });
    expect(s.people.map((p) => [p.email, p.role, p.inherited])).toEqual([
      ["admin@test.local", "owner", false],
      ["exec2@test.local", "writer", false],
      ["asha@repo.test", "writer", true],
      ["exec@test.local", "reader", true],
      ["tl@test.local", "writer", true],
    ]);
    // the Exec with whole-kit Viewer access is still suggested here (to give them more on Work); exec2 is not
    expect(teamSuggestions(s.team, s.people.filter((p) => !p.inherited).map((p) => p.email)).map((u) => u.email)).toEqual(["tl@test.local", "exec@test.local"]);

    // a whole-kit row can't be changed from the folder
    const viaKit = s.people.find((p) => p.email === "tl@test.local")!;
    expect(await a.changeKitShareRole(seed.client.id, { scope: "work", permissionId: viaKit.id, role: "reader" })).toEqual({ ok: false, error: "That access comes from the whole kit — change it under Whole kit" });
    expect((await a.removeKitShareAccess(seed.client.id, { scope: "work", permissionId: "owner" })).ok).toBe(false);

    const mine = s.people.find((p) => p.email === exec2.email)!;
    const changed = await a.changeKitShareRole(seed.client.id, { scope: "work", permissionId: mine.id, role: "commenter" });
    expect(changed.ok && changed.data.people.find((p) => p.email === exec2.email)?.role).toBe("commenter");
    expect((await a.changeKitShareRole(seed.client.id, { scope: "work", permissionId: mine.id, role: "admin" })).ok).toBe(false);
    const removed = await a.removeKitShareAccess(seed.client.id, { scope: "work", permissionId: mine.id });
    expect(removed.ok && removed.data.people.some((p) => p.email === exec2.email)).toBe(false);
    expect(await a.removeKitShareAccess(seed.client.id, { scope: "work", permissionId: mine.id })).toEqual({ ok: false, error: "That person no longer has access" });

    // the whole kit's own rows are editable there
    const kitView = await a.getKitSharing(seed.client.id, { scope: "kit" });
    const tlRow = kitView.ok ? kitView.data.people.find((p) => p.email === "tl@test.local")! : null;
    const tlNow = await a.changeKitShareRole(seed.client.id, { scope: "kit", permissionId: tlRow!.id, role: "reader" });
    expect(tlNow.ok && tlNow.data.people.find((p) => p.email === "tl@test.local")?.role).toBe("reader");
    expect((await testDb.auditLog.findMany({ where: { entityId: seed.client.id, action: { startsWith: "client.kit.share" } }, orderBy: { createdAt: "asc" } })).map((l) => l.action)).toEqual([
      "client.kit.share.add", "client.kit.share.add", "client.kit.share.role", "client.kit.share.remove", "client.kit.share.role",
    ]);
  });

  it("the Credentials pill shares the sheet; link sharing is per part and the kit's link shows on its parts", async () => {
    const c = await kit();
    const a = await import("@/server/clients/kit-share");
    const sheet = await a.shareKit(seed.client.id, { scope: "sheet", people: [{ email: "exec@test.local", role: "writer" }], notify: false });
    if (!sheet.ok) throw new Error(sheet.error);
    expect(sheet.data.sharing).toMatchObject({ title: "Repo Media LLP › Credentials sheet", url: `https://docs.google.com/spreadsheets/d/${c.kitSheetId}/edit` });
    const { listPermissions } = await import("@/google/drive-share");
    expect((await listPermissions(c.kitSheetId!)).map((p) => p.emailAddress)).toContain("exec@test.local");
    expect((await listPermissions(c.kitCredentialsId!)).map((p) => p.emailAddress)).not.toContain("exec@test.local");

    const open = await a.setKitGeneralAccess(seed.client.id, { scope: "kit", access: "anyone", role: "commenter" });
    expect(open.ok && open.data.general).toEqual({ access: "anyone", role: "commenter" });
    const brand = await a.getKitSharing(seed.client.id, { scope: "brand" });
    expect(brand.ok && [brand.data.general.access, brand.data.inheritedLink]).toEqual(["restricted", "commenter"]);
    expect(await a.setKitGeneralAccess(seed.client.id, { scope: "brand", access: "restricted" })).toEqual({ ok: false, error: "The whole kit is open to anyone with the link — change it under Whole kit" });
    await a.setKitGeneralAccess(seed.client.id, { scope: "kit", access: "restricted" });
    const reports = await a.setKitGeneralAccess(seed.client.id, { scope: "reports", access: "anyone", role: "reader" });
    expect(reports.ok && [reports.data.general, reports.data.inheritedLink]).toEqual([{ access: "anyone", role: "reader" }, null]);
    expect((await listPermissions(c.kitReportsId!)).find((p) => p.type === "anyone")?.role).toBe("reader");
  });

  it("read models carry the Share sheet pills", async () => {
    await kit();
    const { listKitRows } = await import("@/server/clients/kit-queries");
    const row = (await listKitRows()).rows[0];
    expect(row.shareScopes.map((s) => s.key)).toEqual(["kit", "brand", "sheet", "work", "reports"]);
    expect(JSON.stringify(row.shareScopes)).not.toContain("fileId");
  });
});
