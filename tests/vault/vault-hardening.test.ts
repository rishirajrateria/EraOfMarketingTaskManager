import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { isHttpUrl, safeHttpUrl } from "@/server/vault/url";

/** ADR 0020: vault links are http(s) only (validated on the server); Admin sees who revealed each credential. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

describe("vault url check (pure)", () => {
  it("accepts http and https only", () => {
    for (const ok of ["https://instagram.com", "http://x.test/a?b=1", "https://drive.google.com/drive/folders/abc"]) expect(isHttpUrl(ok)).toBe(true);
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "ftp://x.test", "vbscript:x", "//evil.test", "instagram.com", "https://", "", "  "]) expect(isHttpUrl(bad)).toBe(false);
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl("https://ok.test")).toBe("https://ok.test");
  });
});

describe("vault hardening", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
  });

  it("create and update refuse non-http(s) links; empty is fine", async () => {
    const { createVaultItem, updateVaultItem } = await import("@/server/vault/actions");
    const base = { clientId: seed.client.id, kind: "CREDENTIAL" as const, label: "Insta" };
    for (const url of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ftp://x.test", "not a url"]) {
      const r = await createVaultItem({ ...base, url });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/http/);
    }
    expect(await testDb.clientVaultItem.count()).toBe(0);
    const ok = await createVaultItem({ ...base, url: "https://instagram.com/repo" });
    expect(ok.ok).toBe(true);
    const blank = await createVaultItem({ ...base, label: "No link", url: "" });
    expect(blank.ok).toBe(true);
    if (!ok.ok) return;
    expect((await updateVaultItem(ok.data.id, { url: "javascript:alert(1)" })).ok).toBe(false);
    expect((await testDb.clientVaultItem.findUniqueOrThrow({ where: { id: ok.data.id } })).url).toBe("https://instagram.com/repo");
    expect((await updateVaultItem(ok.data.id, { url: "https://new.test" })).ok).toBe(true);
  });

  it("a legacy non-http link already in the database is never returned for rendering", async () => {
    await testDb.clientVaultItem.create({ data: { clientId: seed.client.id, kind: "CREDENTIAL", label: "Old", url: "javascript:alert(1)" } });
    const { listVaultItems } = await import("@/server/vault/queries");
    expect((await listVaultItems(seed.client.id, "CREDENTIAL"))[0].url).toBeNull();
  });

  it("Admin sees 'Viewed by' per credential: person, count and last time", async () => {
    const { createVaultItem, grantAccess, revealSecret } = await import("@/server/vault/actions");
    const created = await createVaultItem({ clientId: seed.client.id, kind: "CREDENTIAL", label: "Insta", url: "https://instagram.com", password: "pw" });
    if (!created.ok) throw new Error(created.error);
    const other = await createVaultItem({ clientId: seed.client.id, kind: "CREDENTIAL", label: "Other", password: "pw2" });
    expect(other.ok).toBe(true);
    await grantAccess({ itemId: created.data.id, userIds: [seed.exec.id], expiresAfterFirstOpenMinutes: 60 });
    session.set({ id: seed.exec.id, role: "EXECUTIVE" });
    expect((await revealSecret(created.data.id)).ok).toBe(true);
    expect((await revealSecret(created.data.id)).ok).toBe(true);
    session.set({ id: seed.admin.id, role: "ADMIN" });
    expect((await revealSecret(created.data.id)).ok).toBe(true);

    const { listVaultItems } = await import("@/server/vault/queries");
    const items = await listVaultItems(seed.client.id, "CREDENTIAL");
    const insta = items.find((i) => i.label === "Insta")!;
    expect(insta.viewers.map((v) => [v.userName, v.views])).toEqual([["Admin", 1], ["Arush", 2]]);
    expect(Date.parse(insta.viewers[0].lastViewedAt)).not.toBeNaN();
    expect(items.find((i) => i.label === "Other")!.viewers).toEqual([]);
    expect(JSON.stringify(items)).not.toMatch(/"pw"|passwordEnc/);
  });
});
