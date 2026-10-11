import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { clientWorkFolderId, kitFolderNames, kitUrls } from "@/server/clients/kit-paths";
import { credentialsSheetSpec, KIT_HEADERS, KIT_WAYS } from "@/google/kit-sheet";

/** ADR 0014: client kit — Drive folders + credentials sheet in the owner's Drive, shared with the client, sent by email / WhatsApp. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

describe("client kit", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { businessName: "Repo Media LLP", contact: "Asha", email: "Asha@Repo.test", whatsapp: "+919876543210" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
    (await import("@/google/drive-share")).resetMockSharing();
    (await import("@/google/kit-sheet")).mockSheetLog.length = 0;
    (await import("@/google/gmail")).sentMailDetails.length = 0;
    (await import("@/integrations/whatsapp")).sentWhatsappLog.length = 0;
  });

  it("pure helpers: folder names, urls and the Work folder hook", () => {
    expect(kitFolderNames(null)).toEqual(["Brand kit", "Credentials", "Work", "Reports"]);
    expect(kitFolderNames(["Logos", " ", "Deliverables"])).toEqual(["Logos", "Credentials", "Deliverables", "Reports"]);
    expect(clientWorkFolderId({ kitFolderId: null, kitWorkId: "w" })).toBeNull();
    expect(clientWorkFolderId({ kitFolderId: "k", kitWorkId: "w" })).toBe("w");
    expect(kitUrls({ kitFolderId: "k", kitSheetId: "s" })).toMatchObject({ folder: "https://drive.google.com/drive/folders/k", sheet: "https://docs.google.com/spreadsheets/d/s/edit", brand: null });
    const spec = credentialsSheetSpec("Repo Media LLP", "Era Of Marketing");
    expect(spec.title).toBe("Repo Media LLP — Credentials");
    expect(spec.headers).toEqual(["Platform", "Login URL", "Username / email", "Password", "Way", "2FA code goes to", "Notes"]);
    expect(spec.ways).toEqual(KIT_WAYS);
    expect(spec.examples).toHaveLength(3);
    for (const row of spec.examples) {
      expect(row).toHaveLength(KIT_HEADERS.length);
      expect(KIT_WAYS).toContain(row[4]);
    }
    expect(spec.examples.find((r) => r[0].startsWith("Instagram"))?.[4]).toBe("Sign in with Facebook");
    const guide = spec.guide.map((r) => r[0]).join("\n");
    expect(guide).toMatch(/Sign in with Google.*leave Password blank/);
    expect(guide).toMatch(/Never put bank details, card numbers, UPI PINs/);
    expect(guide).toMatch(/2FA/);
    expect(spec.note).toMatch(/How to fill/);
  });

  it("is admin only and validates the client", async () => {
    const { createClientKit, sendClientKit } = await import("@/server/clients/kit");
    for (const role of ["TEAM_LEADER", "EXECUTIVE", "HR"] as const) {
      session.set({ id: seed.tl.id, role });
      expect((await createClientKit(seed.client.id)).ok).toBe(false);
      expect((await sendClientKit(seed.client.id, { channel: "EMAIL" })).ok).toBe(false);
    }
    session.set({ id: seed.admin.id, role: "ADMIN" });
    expect(await createClientKit("missing")).toEqual({ ok: false, error: "Client not found" });
    expect((await createClientKit("")).ok).toBe(false);
    expect(await sendClientKit(seed.client.id, { channel: "EMAIL" })).toEqual({ ok: false, error: "Create the client kit first" });
    expect((await sendClientKit(seed.client.id, { channel: "SMS" })).ok).toBe(false);
  });

  it("creates Client Kit/<client>/4 folders + the sheet, shares with the client (no Google email), and is idempotent", async () => {
    const { createClientKit } = await import("@/server/clients/kit");
    const { mockId } = await import("@/google/client");
    const r = await createClientKit(seed.client.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ repaired: false, sharedWith: "asha@repo.test", warnings: [] });
    expect(r.data.created).toEqual(["Repo Media LLP", "Brand kit", "Credentials", "Work", "Reports", "Repo Media LLP — Credentials"]);

    const settings = await testDb.companySettings.findUniqueOrThrow({ where: { id: "default" } });
    expect(settings.clientKitRootId).toBe(mockId("folder", "root/Client Kit"));
    const c = await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } });
    expect(c.kitFolderId).toBe(mockId("folder", `${settings.clientKitRootId}/Repo Media LLP`));
    expect(c.kitBrandId).toBe(mockId("folder", `${c.kitFolderId}/Brand kit`));
    expect(c.kitWorkId).toBe(mockId("folder", `${c.kitFolderId}/Work`));
    expect(c.kitReportsId).toBe(mockId("folder", `${c.kitFolderId}/Reports`));
    expect(clientWorkFolderId(c)).toBe(c.kitWorkId);
    const { mockSheetLog } = await import("@/google/kit-sheet");
    expect(mockSheetLog).toHaveLength(1);
    expect(mockSheetLog[0]).toMatchObject({ id: c.kitSheetId, parentId: c.kitCredentialsId });
    expect(c.kitCreatedAt).not.toBeNull();

    const { listPermissions, mockShareNotifications } = await import("@/google/drive-share");
    expect((await listPermissions(c.kitFolderId!)).map((p) => [p.emailAddress, p.role])).toEqual([["admin@test.local", "owner"], ["asha@repo.test", "writer"]]);
    expect(mockShareNotifications).toEqual([]); // we send our own message

    // again: nothing new, same ids, one sheet, no duplicate share
    const again = await createClientKit(seed.client.id);
    expect(again.ok && again.data).toMatchObject({ repaired: true, created: [] });
    const c2 = await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } });
    expect([c2.kitFolderId, c2.kitBrandId, c2.kitCredentialsId, c2.kitWorkId, c2.kitReportsId, c2.kitSheetId]).toEqual([c.kitFolderId, c.kitBrandId, c.kitCredentialsId, c.kitWorkId, c.kitReportsId, c.kitSheetId]);
    expect(mockSheetLog).toHaveLength(1);
    expect((await listPermissions(c.kitFolderId!)).length).toBe(2);

    // repair: a lost subfolder + sheet are recreated, the rest kept
    await testDb.client.update({ where: { id: seed.client.id }, data: { kitReportsId: null, kitSheetId: null } });
    const repaired = await createClientKit(seed.client.id);
    expect(repaired.ok && repaired.data.created).toEqual(["Reports", "Repo Media LLP — Credentials"]);
    expect(mockSheetLog).toHaveLength(2);
    expect((await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } })).kitReportsId).toBe(c.kitReportsId);
    expect((await testDb.auditLog.findMany({ where: { entityId: seed.client.id, action: { startsWith: "client.kit" } }, orderBy: { createdAt: "asc" } })).map((a) => a.action)).toEqual(["client.kit.create", "client.kit.repair", "client.kit.repair"]);

    // the kit folder can be opened in the Share sheet; other client folders cannot
    const { getFolderSharing } = await import("@/server/finance/drive-share");
    const share = await getFolderSharing(c.kitFolderId!);
    expect(share.ok && share.data.title).toBe("Client kit › Repo Media LLP");
    expect((await getFolderSharing(c.kitBrandId!)).ok).toBe(false);
  });

  it("uses the folder names from Settings and warns when the client has no email", async () => {
    await testDb.companySettings.update({ where: { id: "default" }, data: { clientKitFolders: ["Logos", "Logins", "Deliverables", "Monthly reports"] } });
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: null } });
    (await import("@/lib/settings")).invalidateSettingsCache();
    const { createClientKit } = await import("@/server/clients/kit");
    const r = await createClientKit(seed.client.id);
    expect(r.ok && r.data.created).toEqual(["Repo Media LLP", "Logos", "Logins", "Deliverables", "Monthly reports", "Repo Media LLP — Credentials"]);
    expect(r.ok && r.data.sharedWith).toBeNull();
    expect(r.ok && r.data.warnings[0]).toMatch(/No client email/);
  });

  it("sends the kit by email and WhatsApp and records it; a missing channel is refused with a hint", async () => {
    const { createClientKit, sendClientKit } = await import("@/server/clients/kit");
    await createClientKit(seed.client.id);
    const c = await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } });
    const mail = await sendClientKit(seed.client.id, { channel: "EMAIL" });
    expect(mail.ok && mail.data).toMatchObject({ channel: "EMAIL", to: "Asha@Repo.test" });
    const sent = (await import("@/google/gmail")).sentMailDetails.at(-1)!;
    expect(sent.subject).toBe("Your Era Of Marketing client kit");
    expect(sent.text).toContain(`https://drive.google.com/drive/folders/${c.kitFolderId}`);
    expect(sent.text).toMatch(/Hi Asha,[\s\S]*Brand kit[\s\S]*"Repo Media LLP — Credentials" sheet[\s\S]*How to fill[\s\S]*Work[\s\S]*Reports/);

    const wa = await sendClientKit(seed.client.id, { channel: "WHATSAPP", text: "Hi Asha, your kit: link" });
    expect(wa.ok && wa.data.to).toBe("+919876543210");
    expect((await import("@/integrations/whatsapp")).sentWhatsappLog.at(-1)!.body).toBe("Hi Asha, your kit: link");
    const after = await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } });
    expect(after.kitSentVia).toBe("WHATSAPP");
    expect(after.kitSentAt).not.toBeNull();
    expect(await testDb.auditLog.count({ where: { action: "client.kit.send", entityId: seed.client.id } })).toBe(2);

    await testDb.client.update({ where: { id: seed.client.id }, data: { email: null, whatsapp: null, phone: null } });
    const noMail = await sendClientKit(seed.client.id, { channel: "EMAIL" });
    expect(!noMail.ok && noMail.error).toMatch(/no email on file/);
    const noWa = await sendClientKit(seed.client.id, { channel: "WHATSAPP" });
    expect(!noWa.ok && noWa.error).toMatch(/no WhatsApp or phone number/);
    expect((await sendClientKit(seed.client.id, { channel: "EMAIL", text: "" })).ok).toBe(false);
  });

  it("list and detail read models", async () => {
    await testDb.clientVaultItem.createMany({ data: [{ clientId: seed.client.id, kind: "CREDENTIAL", label: "Instagram", username: "repo", passwordEnc: "x" }, { clientId: seed.client.id, kind: "ASSET_DRIVE_LINK", label: "Logos", url: "https://x" }] });
    const { listKitRows, getKitDetail } = await import("@/server/clients/kit-queries");
    let list = await listKitRows();
    expect(list.rows[0]).toMatchObject({ ready: false, partial: false, messages: null, vault: { assets: 1, credentials: 1 } });
    await (await import("@/server/clients/kit")).createClientKit(seed.client.id);
    list = await listKitRows();
    expect(list.owner).toBe("admin@test.local");
    expect(list.rows[0]).toMatchObject({ ready: true, displayName: "Repo Media LLP", whatsapp: "+919876543210" });
    expect(list.rows[0].messages?.whatsapp).toContain(list.rows[0].urls!.folder);
    const d = await getKitDetail(seed.client.id);
    expect(d?.vaultItems.map((i) => [i.kind, i.label, i.hasPassword])).toEqual([["ASSET_DRIVE_LINK", "Logos", false], ["CREDENTIAL", "Instagram", true]]);
    expect(JSON.stringify(d)).not.toContain("passwordEnc");
  });
});
