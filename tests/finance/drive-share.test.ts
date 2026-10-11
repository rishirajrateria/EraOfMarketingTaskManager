import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

/** ADR 0013: Share sheet actions for the Finance root and month folders (GOOGLE_MOCK keeps permissions in memory). */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

describe("finance folder sharing", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
    (await import("@/google/drive-share")).resetMockSharing();
  });

  async function monthFolder() {
    const { ensureMonthFolder } = await import("@/server/finance/month-folders");
    return ensureMonthFolder("2026-10");
  }

  it("month folders live under the cached Finance root in the owner's Drive", async () => {
    const f = await monthFolder();
    const root = await testDb.financeDriveRoot.findUniqueOrThrow({ where: { id: "default" } });
    expect(root.ownerEmail).toBe("admin@test.local"); // mock: first Admin stands in for GOOGLE_IMPERSONATE_USER
    const { mockId } = await import("@/google/client");
    expect(root.folderId).toBe(mockId("folder", "root/Finance"));
    expect(f.folderId).toBe(mockId("folder", `${root.folderId}/2026-10`));
    const { driveFolderMonths } = await import("@/server/finance/drive-folders-queries");
    const page = await driveFolderMonths(new Date("2026-10-10T06:00:00Z"));
    expect(page.owner).toBe("admin@test.local");
    expect(page.finance?.id).toBe(root.folderId);
    expect(page.rows.find((r) => r.month === "2026-10")?.folderId).toBe(f.folderId);
  });

  it("is admin only", async () => {
    const f = await monthFolder();
    const { getFolderSharing, shareFolder } = await import("@/server/finance/drive-share");
    for (const role of ["TEAM_LEADER", "EXECUTIVE", "HR"] as const) {
      session.set({ id: seed.tl.id, role });
      expect((await getFolderSharing(f.folderId)).ok).toBe(false);
      expect((await shareFolder(f.folderId, { emails: ["ca@firm.in"], role: "reader" })).ok).toBe(false);
    }
  });

  it("rejects folders the app did not create", async () => {
    await monthFolder();
    const { getFolderSharing, shareFolder, setGeneralAccess } = await import("@/server/finance/drive-share");
    const { FOREIGN_FOLDER_ERROR } = await import("@/server/finance/drive-share-core");
    for (const id of ["1AbcForeignFolderId", "x' or 1=1", "", "../root"]) {
      expect(await getFolderSharing(id)).toEqual({ ok: false, error: FOREIGN_FOLDER_ERROR });
      expect(await shareFolder(id, { emails: ["ca@firm.in"], role: "reader" })).toEqual({ ok: false, error: FOREIGN_FOLDER_ERROR });
      expect(await setGeneralAccess(id, { access: "anyone", role: "reader" })).toEqual({ ok: false, error: FOREIGN_FOLDER_ERROR });
    }
    expect(await testDb.auditLog.count({ where: { action: { startsWith: "drive.share" } } })).toBe(0);
  });

  it("validates input", async () => {
    const f = await monthFolder();
    const { shareFolder, changeShareRole } = await import("@/server/finance/drive-share");
    expect((await shareFolder(f.folderId, { emails: [], role: "reader" })).ok).toBe(false);
    const bad = await shareFolder(f.folderId, { emails: ["not-an-email"], role: "reader" });
    expect(!bad.ok && bad.error).toMatch(/valid email/);
    expect((await shareFolder(f.folderId, { emails: ["ca@firm.in"], role: "owner" })).ok).toBe(false);
    expect((await shareFolder(f.folderId, { emails: ["admin@test.local"], role: "writer" })).ok).toBe(false); // the owner
    expect((await changeShareRole(f.folderId, { permissionId: "owner", role: "reader" })).ok).toBe(false);
  });

  it("round trip: add people with a note, change a role, link sharing, remove — all audited", async () => {
    const f = await monthFolder();
    const { getFolderSharing, shareFolder, changeShareRole, removeShareAccess, setGeneralAccess } = await import("@/server/finance/drive-share");
    const { mockShareNotifications } = await import("@/google/drive-share");
    const first = await getFolderSharing(f.folderId);
    expect(first.ok && first.data).toMatchObject({ title: "Finance › October 2026", owner: "admin@test.local", general: { access: "restricted" } });
    expect(first.ok && first.data.people).toEqual([expect.objectContaining({ email: "admin@test.local", isOwner: true, role: "owner" })]);

    const added = await shareFolder(f.folderId, { emails: [" CA@Firm.in ", "partner@firm.in"], role: "commenter", notify: true, message: "October books" });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.data.added).toEqual(["ca@firm.in", "partner@firm.in"]);
    expect(added.data.sharing.people.map((p) => [p.email, p.role])).toEqual([["admin@test.local", "owner"], ["ca@firm.in", "commenter"], ["partner@firm.in", "commenter"]]);
    expect(mockShareNotifications).toEqual([
      { fileId: f.folderId, to: "ca@firm.in", role: "commenter", message: "October books" },
      { fileId: f.folderId, to: "partner@firm.in", role: "commenter", message: "October books" },
    ]);

    const ca = added.data.sharing.people.find((p) => p.email === "ca@firm.in")!;
    const changed = await changeShareRole(f.folderId, { permissionId: ca.id, role: "writer" });
    expect(changed.ok && changed.data.people.find((p) => p.id === ca.id)?.role).toBe("writer");

    const link = await setGeneralAccess(f.folderId, { access: "anyone", role: "reader" });
    expect(link.ok && link.data.general).toEqual({ access: "anyone", role: "reader" });
    const linkEdit = await setGeneralAccess(f.folderId, { access: "anyone", role: "commenter" });
    expect(linkEdit.ok && linkEdit.data.general).toEqual({ access: "anyone", role: "commenter" });
    expect(linkEdit.ok && linkEdit.data.people.some((p) => p.kind === "anyone")).toBe(false);

    const removed = await removeShareAccess(f.folderId, { permissionId: ca.id });
    expect(removed.ok && removed.data.people.map((p) => p.email)).toEqual(["admin@test.local", "partner@firm.in"]);
    const restricted = await setGeneralAccess(f.folderId, { access: "restricted" });
    expect(restricted.ok && restricted.data.general.access).toBe("restricted");
    expect((await removeShareAccess(f.folderId, { permissionId: ca.id })).ok).toBe(false); // already gone

    const actions = (await testDb.auditLog.findMany({ where: { entityId: f.folderId }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["drive.share.add", "drive.share.role", "drive.share.link", "drive.share.link", "drive.share.remove", "drive.share.link"]);
  });

  it("the Finance root can be shared too", async () => {
    await monthFolder();
    const root = await testDb.financeDriveRoot.findUniqueOrThrow({ where: { id: "default" } });
    const { shareFolder } = await import("@/server/finance/drive-share");
    const r = await shareFolder(root.folderId, { emails: ["ca@firm.in"], role: "reader", notify: false });
    expect(r.ok && r.data.sharing).toMatchObject({ title: "Finance", people: [expect.objectContaining({ isOwner: true }), expect.objectContaining({ email: "ca@firm.in", role: "reader" })] });
    expect((await import("@/google/drive-share")).mockShareNotifications).toEqual([]);
  });
});
