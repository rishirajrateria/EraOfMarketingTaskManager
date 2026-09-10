import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { vi } from "vitest";
import type { SessionUser } from "@/lib/rbac";

// Same API as tests/helpers/mock-session.ts, but with hoisted state: vitest hoists `vi.mock` to the top of
// the file, so a factory that closes over a function-local variable (as the helper does) loses it.
const state = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock("@/lib/auth", () => ({
  auth: async () => (state.current ? { user: state.current } : null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));
const session = {
  set(u: { id: string; role: SessionUser["role"]; teamId?: string | null; teamLeaderId?: string | null; name?: string; email?: string }) {
    state.current = { id: u.id, role: u.role, teamId: u.teamId ?? null, teamLeaderId: u.teamLeaderId ?? null, name: u.name, email: u.email };
  },
  clear() {
    state.current = null;
  },
};

const actions = () => import("@/server/vault/actions");
const queries = () => import("@/server/vault/queries");

type Seed = Awaited<ReturnType<typeof seedBasics>>;
let s: Seed;

async function createItemAsAdmin(password = "s3cret!") {
  session.set(s.admin);
  const { createVaultItem } = await actions();
  const res = await createVaultItem({ clientId: s.client.id, kind: "CREDENTIAL", label: "Instagram", url: "https://instagram.com", username: "repo", password, notes: "n" });
  if (!res.ok) throw new Error(res.error);
  return res.data.id;
}

describe("vault", () => {
  beforeEach(async () => {
    await resetDb();
    s = await seedBasics();
    session.clear();
  });

  it("admin creates an item; the password is encrypted at rest and never in DTOs or audit", async () => {
    const id = await createItemAsAdmin("hunter2");
    const row = await testDb.clientVaultItem.findUniqueOrThrow({ where: { id } });
    expect(row.passwordEnc).toBeTruthy();
    expect(row.passwordEnc).not.toContain("hunter2");
    const { listVaultItems } = await queries();
    const [dto] = await listVaultItems(s.client.id, "CREDENTIAL");
    expect(dto).toMatchObject({ id, label: "Instagram", hasPassword: true });
    expect(JSON.stringify(dto)).not.toContain("hunter2");
    expect("passwordEnc" in dto!).toBe(false);
    const logs = await testDb.auditLog.findMany({ where: { entityId: id } });
    expect(logs.map((l) => l.action)).toContain("vault.item.create");
    expect(JSON.stringify(logs)).not.toContain("hunter2");
    expect(JSON.stringify(logs)).not.toContain(row.passwordEnc);
  });

  it("non-admins cannot create items; non-granted exec cannot reveal; admin always can", async () => {
    const id = await createItemAsAdmin();
    const { createVaultItem, revealSecret } = await actions();
    session.set(s.exec);
    const denied = await createVaultItem({ clientId: s.client.id, kind: "CREDENTIAL", label: "x" });
    expect(denied.ok).toBe(false);
    const res = await revealSecret(id);
    expect(res.ok).toBe(false);
    expect(await testDb.vaultViewLog.count()).toBe(0);
    session.set(s.admin);
    const ok = await revealSecret(id);
    expect(ok.ok && ok.data.password).toBe("s3cret!");
    expect(ok.ok && ok.data.grant).toBeNull();
    expect(await testDb.vaultViewLog.count({ where: { userId: s.admin.id } })).toBe(1);
    session.clear();
    expect((await revealSecret(id)).ok).toBe(false);
  });

  it("after a grant the exec can reveal: firstOpenedAt is set once, view + audit logged, then expiry refuses and the job revokes", async () => {
    const id = await createItemAsAdmin("pw-1");
    const { grantAccess, revealSecret } = await actions();
    session.set(s.admin);
    const g = await grantAccess({ userIds: [s.exec.id], itemId: id, expiresAfterFirstOpenMinutes: 1 });
    expect(g.ok && g.data.grants).toBe(1);
    const notif = await testDb.notification.findFirst({ where: { userId: s.exec.id, kind: "VAULT_ACCESS_GRANTED" } });
    expect(notif?.href).toBe("/vault");

    session.set(s.exec);
    const { listGrantedItems } = await queries();
    const groups = await listGrantedItems(s.exec.id);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.kinds[0]!.items[0]!.id).toBe(id);

    const r1 = await revealSecret(id);
    expect(r1.ok && r1.data.password).toBe("pw-1");
    const grant1 = await testDb.vaultAccessGrant.findFirstOrThrow({ where: { vaultItemId: id, userId: s.exec.id } });
    expect(grant1.firstOpenedAt).toBeInstanceOf(Date);
    expect(r1.ok && r1.data.grant?.effectiveExpiresAt).toBe(new Date(grant1.firstOpenedAt!.getTime() + 60_000).toISOString());
    expect(await testDb.vaultViewLog.count({ where: { vaultItemId: id, userId: s.exec.id } })).toBe(1);
    const reveals = await testDb.auditLog.findMany({ where: { action: "vault.reveal", entityId: id } });
    expect(reveals).toHaveLength(1);
    expect(reveals[0]!.actorId).toBe(s.exec.id);
    expect(JSON.stringify(reveals)).not.toContain("pw-1");

    // second reveal keeps the original firstOpenedAt
    const r2 = await revealSecret(id);
    expect(r2.ok).toBe(true);
    const grant2 = await testDb.vaultAccessGrant.findUniqueOrThrow({ where: { id: grant1.id } });
    expect(grant2.firstOpenedAt!.toISOString()).toBe(grant1.firstOpenedAt!.toISOString());
    expect(await testDb.vaultViewLog.count({ where: { vaultItemId: id, userId: s.exec.id } })).toBe(2);

    // simulate expiry: opened 5 minutes ago with a 1 minute window
    await testDb.vaultAccessGrant.update({ where: { id: grant1.id }, data: { firstOpenedAt: new Date(Date.now() - 5 * 60_000) } });
    const r3 = await revealSecret(id);
    expect(r3.ok).toBe(false);
    expect(await testDb.vaultViewLog.count({ where: { vaultItemId: id, userId: s.exec.id } })).toBe(2);
    expect(await listGrantedItems(s.exec.id)).toHaveLength(0);

    const { run } = await import("@/jobs/vault-expiry");
    const out = await run();
    expect(out.expired).toBe(1);
    const grant3 = await testDb.vaultAccessGrant.findUniqueOrThrow({ where: { id: grant1.id } });
    expect(grant3.revoked).toBe(true);
    expect((await run()).expired).toBe(0);
  });

  it("revoked users lose access immediately; re-granting resets the grant", async () => {
    const id = await createItemAsAdmin();
    const { grantAccess, revokeGrant, revealSecret } = await actions();
    session.set(s.admin);
    await grantAccess({ userIds: [s.tl.id], itemId: id });
    const grant = await testDb.vaultAccessGrant.findFirstOrThrow({ where: { vaultItemId: id, userId: s.tl.id } });
    session.set(s.tl);
    expect((await revealSecret(id)).ok).toBe(true);
    session.set(s.admin);
    expect((await revokeGrant(grant.id)).ok).toBe(true);
    session.set(s.tl);
    expect((await revealSecret(id)).ok).toBe(false);
    expect((await revokeGrant(grant.id)).ok).toBe(false); // not admin
    session.set(s.admin);
    await grantAccess({ userIds: [s.tl.id], itemId: id, expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    const again = await testDb.vaultAccessGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(again.revoked).toBe(false);
    expect(again.firstOpenedAt).toBeNull();
    expect(again.expiresAt).toBeInstanceOf(Date);
    session.set(s.tl);
    expect((await revealSecret(id)).ok).toBe(true);
  });

  it("per-client grant covers every current item and the expiry job warns 30 min ahead once", async () => {
    const id1 = await createItemAsAdmin();
    const { createVaultItem, grantAccess } = await actions();
    const r = await createVaultItem({ clientId: s.client.id, kind: "ASSET_DRIVE_LINK", label: "Assets", url: "https://drive.google.com/x" });
    const id2 = r.ok ? r.data.id : "";
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const g = await grantAccess({ userIds: [s.exec.id, s.tl.id], clientId: s.client.id, expiresAt });
    expect(g.ok && g.data.grants).toBe(4);
    expect(await testDb.vaultAccessGrant.count({ where: { vaultItemId: { in: [id1, id2] } } })).toBe(4);
    expect(await testDb.notification.count({ where: { kind: "VAULT_ACCESS_GRANTED" } })).toBe(2);

    const { run } = await import("@/jobs/vault-expiry");
    const first = await run();
    expect(first).toEqual({ notified: 4, expired: 0 });
    expect(await testDb.notification.count({ where: { kind: "VAULT_ACCESS_EXPIRING" } })).toBe(4);
    expect(await run()).toEqual({ notified: 0, expired: 0 }); // already warned
    expect(await testDb.vaultAccessGrant.count({ where: { expiringNotifiedAt: null } })).toBe(0);
  });

  it("admin can edit and delete items; edit without password keeps the secret", async () => {
    const id = await createItemAsAdmin("keep-me");
    const { updateVaultItem, deleteVaultItem, revealSecret } = await actions();
    session.set(s.admin);
    expect((await updateVaultItem(id, { label: "IG", username: "new" })).ok).toBe(true);
    const rev = await revealSecret(id);
    expect(rev.ok && rev.data.password).toBe("keep-me");
    expect((await updateVaultItem(id, { password: "" })).ok).toBe(true);
    const rev2 = await revealSecret(id);
    expect(rev2.ok && rev2.data.password).toBeNull();
    expect((await deleteVaultItem(id)).ok).toBe(true);
    expect(await testDb.clientVaultItem.count()).toBe(0);
    expect(await testDb.auditLog.count({ where: { action: "vault.item.delete" } })).toBe(1);
  });

  it("admin adds a client", async () => {
    const { createClient } = await actions();
    session.set(s.admin);
    const res = await createClient({ name: "Acme", contact: "Bob", email: "bob@acme.test", gstNumber: "27ABCDE1234F1Z5", address: "Pune" });
    expect(res.ok).toBe(true);
    expect((await createClient({ name: "" })).ok).toBe(false);
    session.set(s.exec);
    expect((await createClient({ name: "Nope" })).ok).toBe(false);
  });
});
