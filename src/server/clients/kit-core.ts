import { z } from "zod";
import type { Client } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";
import { isMock } from "@/google/client";
import { ensureFolder, fileAlive } from "@/google/drive";
import { createCredentialsSheet, credentialsSheetSpec } from "@/google/kit-sheet";
import { sendMail } from "@/google/gmail";
import { sendWhatsapp } from "@/integrations/whatsapp";
import { clientDisplayName } from "@/server/finance/file-names";
import { financeDriveOwner } from "@/server/finance/month-folders";
import { clientLinks, hasKit, kitFinalName, kitFolderNames, kitMessage, kitUrls } from "@/server/clients/kit-paths";
import { syncClientSharing } from "@/server/clients/kit-client-share";

/**
 * Client kit (ADR 0014, ADR 0020): in the owner's My Drive, `Client Kit/<client>/{Brand kit, Credentials, Work, Reports,
 * Final work}` plus a premade "<client> — Credentials" sheet in Credentials. The client is shared ONLY on Brand kit, the
 * Credentials sheet, Reports and Final work (never the kit root or Work), without Google's notification (we send our
 * own message by email / WhatsApp). Creating again repairs what is missing (dead ids are replaced, existing ones kept)
 * and re-applies the sharing rule ("Fix sharing"). GOOGLE_MOCK works end to end.
 */
export const KIT_ROOT_NAME = "Client Kit";
export const sendKitSchema = z.object({ channel: z.enum(["EMAIL", "WHATSAPP"]), text: z.string().trim().min(1, "Write a message").max(3000).optional().nullable() });

/** The "Client Kit" top folder in the owner's My Drive, created once and cached in settings. */
export async function ensureKitRoot(): Promise<string> {
  const s = await getSettings();
  if (s.clientKitRootId && (await fileAlive(s.clientKitRootId))) return s.clientKitRootId;
  if (!isMock() && !env.impersonateUser) throw new Error("Set GOOGLE_IMPERSONATE_USER so client kits are created in the owner's Google Drive");
  const root = await ensureFolder(KIT_ROOT_NAME); // no parent → the impersonated owner's My Drive
  await prisma.companySettings.update({ where: { id: "default" }, data: { clientKitRootId: root.id } });
  invalidateSettingsCache();
  return root.id;
}

const keep = async (id: string | null | undefined) => (id && (await fileAlive(id)) ? id : null);

export type KitResult = { clientId: string; repaired: boolean; created: string[]; sharedWith: string | null; revoked: number; warnings: string[] };

export async function createKitCore(clientId: string, actorId: string): Promise<KitResult> {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Client not found");
  const settings = await getSettings();
  const names = [...kitFolderNames(settings.clientKitFolders), kitFinalName(settings.clientKitFolders)];
  const display = clientDisplayName(client);
  const created: string[] = [];
  const hadKit = Boolean(client.kitFolderId);

  const root = await ensureKitRoot();
  let folderId = await keep(client.kitFolderId);
  if (!folderId) {
    folderId = (await ensureFolder(display, root)).id;
    created.push(display);
  }
  const subs: (keyof Pick<Client, "kitBrandId" | "kitCredentialsId" | "kitWorkId" | "kitReportsId" | "kitFinalId">)[] = ["kitBrandId", "kitCredentialsId", "kitWorkId", "kitReportsId", "kitFinalId"];
  const ids: Record<string, string> = {};
  for (const [i, col] of subs.entries()) {
    const alive = folderId === client.kitFolderId ? await keep(client[col]) : null;
    if (alive) ids[col] = alive;
    else {
      ids[col] = (await ensureFolder(names[i], folderId)).id;
      created.push(names[i]);
    }
  }
  let sheetId = ids.kitCredentialsId === client.kitCredentialsId ? await keep(client.kitSheetId) : null;
  if (!sheetId) {
    sheetId = await createCredentialsSheet(ids.kitCredentialsId, credentialsSheetSpec(display, settings.companyName));
    created.push(`${display} — Credentials`);
  }

  const share = await syncClientSharing(
    { ...client, kitFolderId: folderId, kitBrandId: ids.kitBrandId, kitCredentialsId: ids.kitCredentialsId, kitWorkId: ids.kitWorkId, kitReportsId: ids.kitReportsId, kitFinalId: ids.kitFinalId, kitSheetId: sheetId },
    { owner: await financeDriveOwner(), companyName: settings.companyName },
  );
  const sharedWith = share.sharedWith;
  const warnings = share.warnings;

  const data = { kitFolderId: folderId, kitBrandId: ids.kitBrandId, kitCredentialsId: ids.kitCredentialsId, kitWorkId: ids.kitWorkId, kitReportsId: ids.kitReportsId, kitFinalId: ids.kitFinalId, kitSheetId: sheetId, kitSharedWith: sharedWith, kitCreatedAt: client.kitCreatedAt ?? new Date() };
  await prisma.client.update({ where: { id: clientId }, data });
  await audit(actorId, hadKit ? "client.kit.repair" : "client.kit.create", "Client", clientId, hadKit ? kitSnapshot(client) : undefined, { ...data, created, warnings, revoked: share.revoked });
  return { clientId, repaired: hadKit, created, sharedWith, revoked: share.revoked.length, warnings };
}

const kitSnapshot = (c: Client) => ({ kitFolderId: c.kitFolderId, kitBrandId: c.kitBrandId, kitCredentialsId: c.kitCredentialsId, kitWorkId: c.kitWorkId, kitReportsId: c.kitReportsId, kitFinalId: c.kitFinalId, kitSheetId: c.kitSheetId });

const whatsappOf = (c: Pick<Client, "whatsapp" | "phone">) => c.whatsapp?.trim() || c.phone?.trim() || null;

/** Default email and WhatsApp texts for the send sheet. */
export async function kitMessages(client: Client): Promise<{ email: string; whatsapp: string } | null> {
  const urls = kitUrls(client);
  if (!urls) return null;
  const s = await getSettings();
  const base = { greetName: client.contact?.trim() || clientDisplayName(client), clientName: clientDisplayName(client), company: s.companyName, links: clientLinks(urls), folders: kitFolderNames(s.clientKitFolders), finalName: kitFinalName(s.clientKitFolders) };
  return { email: kitMessage({ ...base, channel: "EMAIL" }), whatsapp: kitMessage({ ...base, channel: "WHATSAPP" }) };
}

export async function sendKitCore(clientId: string, input: z.output<typeof sendKitSchema>, actorId: string): Promise<{ channel: "EMAIL" | "WHATSAPP"; to: string; sentAt: string }> {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Client not found");
  if (!hasKit(client)) throw new Error("Create the client kit first");
  const texts = (await kitMessages(client))!;
  const company = (await getSettings()).companyName;
  let to: string;
  if (input.channel === "EMAIL") {
    if (!client.email) throw new Error("This client has no email on file — add it on the client first");
    to = client.email;
    await sendMail({ to, subject: `Your ${company} client kit`, text: input.text ?? texts.email });
  } else {
    const number = whatsappOf(client);
    if (!number) throw new Error("This client has no WhatsApp or phone number — add it on the client first");
    const r = await sendWhatsapp({ to: number, body: input.text ?? texts.whatsapp });
    if (!r.ok) throw new Error(`WhatsApp failed: ${r.error}`);
    to = number;
  }
  const sentAt = new Date();
  await prisma.client.update({ where: { id: clientId }, data: { kitSentAt: sentAt, kitSentVia: input.channel } });
  await audit(actorId, "client.kit.send", "Client", clientId, undefined, { channel: input.channel, to });
  return { channel: input.channel, to, sentAt: sentAt.toISOString() };
}

/**
 * Re-applies the sharing rule without creating anything: used when a client's email changes (the old address loses
 * access), a client is deactivated (everyone loses access) or reactivated, and by the "Fix sharing" button's lighter path.
 * A client without a kit has nothing to sync. Revoke failures are logged, audited and kept for a retry (kitSharedWith).
 */
export async function syncKitSharingCore(clientId: string, actorId: string): Promise<{ revoked: number; sharedWith: string | null; warnings: string[] } | null> {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client?.kitFolderId) return null;
  const settings = await getSettings();
  const share = await syncClientSharing(client, { owner: await financeDriveOwner(), companyName: settings.companyName });
  await prisma.client.update({ where: { id: clientId }, data: { kitSharedWith: share.sharedWith } });
  await audit(actorId, "client.kit.sharing.sync", "Client", clientId, { kitSharedWith: client.kitSharedWith, active: client.active }, { kitSharedWith: share.sharedWith, revoked: share.revoked, granted: share.granted, warnings: share.warnings });
  for (const w of share.warnings) console.error("[client-kit] sharing:", clientId, w);
  return { revoked: share.revoked.length, sharedWith: share.sharedWith, warnings: share.warnings };
}
