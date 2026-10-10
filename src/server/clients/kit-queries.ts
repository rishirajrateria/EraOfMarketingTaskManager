import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { clientDisplayName } from "@/server/finance/file-names";
import { financeDriveOwner } from "@/server/finance/month-folders";
import { hasKit, kitFolderNames, kitMessage, kitUrls } from "@/server/clients/kit-paths";

/** Read models for the Client kit screens (ADR 0014). Plain values only. */
export type KitRow = {
  clientId: string;
  name: string;
  displayName: string;
  email: string | null;
  whatsapp: string | null;
  ready: boolean;
  partial: boolean;
  folderId: string | null;
  urls: ReturnType<typeof kitUrls>;
  createdAt: string | null;
  sentAt: string | null;
  sentVia: string | null;
  sharedWith: string | null;
  vault: { assets: number; credentials: number };
  /** Default email / WhatsApp texts for the send sheet (null until the kit exists). */
  messages: { email: string; whatsapp: string } | null;
};

const KIT_SELECT = {
  id: true, name: true, businessName: true, contact: true, email: true, whatsapp: true, phone: true,
  kitFolderId: true, kitBrandId: true, kitCredentialsId: true, kitSheetId: true, kitWorkId: true, kitReportsId: true,
  kitCreatedAt: true, kitSentAt: true, kitSentVia: true, kitSharedWith: true,
} as const;

type Sel = { id: string; name: string; businessName: string | null; contact: string | null; email: string | null; whatsapp: string | null; phone: string | null; kitFolderId: string | null; kitBrandId: string | null; kitCredentialsId: string | null; kitSheetId: string | null; kitWorkId: string | null; kitReportsId: string | null; kitCreatedAt: Date | null; kitSentAt: Date | null; kitSentVia: string | null; kitSharedWith: string | null };

type Ctx = { company: string; folders: [string, string, string, string] };

function toRow(c: Sel, vault: Map<string, { assets: number; credentials: number }>, ctx: Ctx): KitRow {
  const ready = hasKit(c);
  const urls = kitUrls(c);
  const base = urls ? { greetName: c.contact?.trim() || clientDisplayName(c), clientName: clientDisplayName(c), company: ctx.company, url: urls.folder, folders: ctx.folders } : null;
  return {
    clientId: c.id,
    name: c.name,
    displayName: clientDisplayName(c),
    email: c.email,
    whatsapp: c.whatsapp?.trim() || c.phone?.trim() || null,
    ready,
    partial: !ready && Boolean(c.kitFolderId),
    folderId: c.kitFolderId,
    urls,
    createdAt: c.kitCreatedAt?.toISOString() ?? null,
    sentAt: c.kitSentAt?.toISOString() ?? null,
    sentVia: c.kitSentVia,
    sharedWith: c.kitSharedWith,
    vault: vault.get(c.id) ?? { assets: 0, credentials: 0 },
    messages: base ? { email: kitMessage({ ...base, channel: "EMAIL" }), whatsapp: kitMessage({ ...base, channel: "WHATSAPP" }) } : null,
  };
}

async function vaultCounts(clientIds?: string[]) {
  const rows = await prisma.clientVaultItem.groupBy({ by: ["clientId", "kind"], where: { kind: { in: ["ASSET_DRIVE_LINK", "CREDENTIAL"] }, ...(clientIds ? { clientId: { in: clientIds } } : {}) }, _count: { _all: true } });
  const map = new Map<string, { assets: number; credentials: number }>();
  for (const r of rows) {
    const v = map.get(r.clientId) ?? { assets: 0, credentials: 0 };
    if (r.kind === "ASSET_DRIVE_LINK") v.assets = r._count._all;
    else v.credentials = r._count._all;
    map.set(r.clientId, v);
  }
  return map;
}

export async function listKitRows(): Promise<{ rows: KitRow[]; owner: string | null; folders: [string, string, string, string] }> {
  const [clients, vault, owner, s] = await Promise.all([
    prisma.client.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: KIT_SELECT }),
    vaultCounts(),
    financeDriveOwner(),
    getSettings(),
  ]);
  const folders = kitFolderNames(s.clientKitFolders);
  return { rows: clients.map((c) => toRow(c, vault, { company: s.companyName, folders })), owner, folders };
}

export type KitDetail = {
  row: KitRow;
  folders: [string, string, string, string];
  vaultItems: { id: string; kind: "ASSET_DRIVE_LINK" | "CREDENTIAL"; label: string; url: string | null; username: string | null; hasPassword: boolean }[];
};

export async function getKitDetail(clientId: string): Promise<KitDetail | null> {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: KIT_SELECT });
  if (!client) return null;
  const [vault, items, s] = await Promise.all([
    vaultCounts([clientId]),
    prisma.clientVaultItem.findMany({ where: { clientId, kind: { in: ["ASSET_DRIVE_LINK", "CREDENTIAL"] } }, orderBy: [{ kind: "asc" }, { label: "asc" }], select: { id: true, kind: true, label: true, url: true, username: true, passwordEnc: true } }),
    getSettings(),
  ]);
  const folders = kitFolderNames(s.clientKitFolders);
  return {
    row: toRow(client, vault, { company: s.companyName, folders }),
    folders,
    vaultItems: items.map((i) => ({ id: i.id, kind: i.kind as "ASSET_DRIVE_LINK" | "CREDENTIAL", label: i.label, url: i.url, username: i.username, hasPassword: Boolean(i.passwordEnc) })),
  };
}
