import { z } from "zod";
import type { Client } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";
import { isMock } from "@/google/client";
import { ensureFolder, fileAlive } from "@/google/drive";
import { addPeople } from "@/google/drive-share";
import { createCredentialsSheet, credentialsSheetSpec } from "@/google/kit-sheet";
import { sendMail } from "@/google/gmail";
import { sendWhatsapp } from "@/integrations/whatsapp";
import { clientDisplayName } from "@/server/finance/file-names";
import { financeDriveOwner } from "@/server/finance/month-folders";
import { hasKit, kitFolderNames, kitMessage, kitUrls } from "@/server/clients/kit-paths";

/**
 * Client kit (ADR 0014): in the owner's My Drive, `Client Kit/<client>/{Brand kit, Credentials, Work, Reports}` plus a
 * premade "<client> — Credentials" sheet in Credentials. The client folder is shared with the client's email as
 * Editor without Google's notification (we send our own message by email / WhatsApp). Creating again repairs what is
 * missing (dead ids are replaced, existing ones kept) instead of duplicating. GOOGLE_MOCK works end to end.
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

export type KitResult = { clientId: string; repaired: boolean; created: string[]; sharedWith: string | null; warnings: string[] };

export async function createKitCore(clientId: string, actorId: string): Promise<KitResult> {
  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Client not found");
  const settings = await getSettings();
  const names = kitFolderNames(settings.clientKitFolders);
  const display = clientDisplayName(client);
  const created: string[] = [];
  const warnings: string[] = [];
  const hadKit = Boolean(client.kitFolderId);

  const root = await ensureKitRoot();
  let folderId = await keep(client.kitFolderId);
  if (!folderId) {
    folderId = (await ensureFolder(display, root)).id;
    created.push(display);
  }
  const subs: (keyof Pick<Client, "kitBrandId" | "kitCredentialsId" | "kitWorkId" | "kitReportsId">)[] = ["kitBrandId", "kitCredentialsId", "kitWorkId", "kitReportsId"];
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

  let sharedWith = client.kitSharedWith && folderId === client.kitFolderId ? client.kitSharedWith : null;
  const email = client.email?.trim().toLowerCase() || null;
  if (email && sharedWith !== email) {
    const owner = await financeDriveOwner();
    let r = await addPeople(folderId, [email], "writer", { notify: false, owner });
    // Drive only lets a non-Google address in with its own invitation email; fall back to that rather than fail.
    if (r.added.length === 0) r = await addPeople(folderId, [email], "writer", { notify: true, message: `${settings.companyName} shared your client kit with you.`, owner });
    if (r.added.length) sharedWith = email;
    else warnings.push(`Could not share with ${email}: ${r.failed[0]?.error ?? "unknown error"}. Use Share to add them.`);
  } else if (!email) warnings.push("No client email on file: the folder is not shared with the client yet.");

  const data = { kitFolderId: folderId, kitBrandId: ids.kitBrandId, kitCredentialsId: ids.kitCredentialsId, kitWorkId: ids.kitWorkId, kitReportsId: ids.kitReportsId, kitSheetId: sheetId, kitSharedWith: sharedWith, kitCreatedAt: client.kitCreatedAt ?? new Date() };
  await prisma.client.update({ where: { id: clientId }, data });
  await audit(actorId, hadKit ? "client.kit.repair" : "client.kit.create", "Client", clientId, hadKit ? kitSnapshot(client) : undefined, { ...data, created, warnings });
  return { clientId, repaired: hadKit, created, sharedWith, warnings };
}

const kitSnapshot = (c: Client) => ({ kitFolderId: c.kitFolderId, kitBrandId: c.kitBrandId, kitCredentialsId: c.kitCredentialsId, kitWorkId: c.kitWorkId, kitReportsId: c.kitReportsId, kitSheetId: c.kitSheetId });

const whatsappOf = (c: Pick<Client, "whatsapp" | "phone">) => c.whatsapp?.trim() || c.phone?.trim() || null;

/** Default email and WhatsApp texts for the send sheet. */
export async function kitMessages(client: Client): Promise<{ email: string; whatsapp: string } | null> {
  const urls = kitUrls(client);
  if (!urls) return null;
  const s = await getSettings();
  const base = { greetName: client.contact?.trim() || clientDisplayName(client), clientName: clientDisplayName(client), company: s.companyName, url: urls.folder, folders: kitFolderNames(s.clientKitFolders) };
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
