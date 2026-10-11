import { prisma } from "@/lib/db";
import type { VaultItemKind } from "@prisma/client";
import { grantExpiresAt, grantIsActive } from "@/server/vault/access";

export const VAULT_KINDS: VaultItemKind[] = ["ASSET_DRIVE_LINK", "CREDENTIAL", "SHARED_DRIVE_LINK"];

export const KIND_LABEL: Record<VaultItemKind, string> = {
  ASSET_DRIVE_LINK: "Assets Drive Links",
  CREDENTIAL: "Credentials",
  SHARED_DRIVE_LINK: "Shared Drive Links",
};

/** Grant as shown to Admin. Dates are ISO strings so the DTO is safe to pass to client components. */
export type GrantDto = {
  id: string;
  userId: string;
  userName: string;
  expiresAt: string | null;
  expiresAfterFirstOpenMinutes: number | null;
  firstOpenedAt: string | null;
  revoked: boolean;
  active: boolean;
  effectiveExpiresAt: string | null;
};

/** Vault item DTO — never contains `passwordEnc`; only `hasPassword`. */
export type VaultItemDto = {
  id: string;
  clientId: string;
  kind: VaultItemKind;
  label: string;
  url: string | null;
  username: string | null;
  notes: string | null;
  hasPassword: boolean;
  grants: GrantDto[];
};

export type ClientDto = { id: string; name: string; contact: string | null; email: string | null; gstNumber: string | null; address: string | null };
export type UserOption = { id: string; name: string; role: string };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function listVaultClients(): Promise<ClientDto[]> {
  return prisma.client.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, contact: true, email: true, gstNumber: true, address: true },
  });
}

export async function listGrantableUsers(): Promise<UserOption[]> {
  return prisma.user.findMany({
    where: { active: true, role: { in: ["TEAM_LEADER", "EXECUTIVE"] } }, // HR/CA never get vault access (SPEC §2)
    orderBy: { name: "asc" },
    select: { id: true, name: true, role: true },
  });
}

/** Admin list: items of one client + kind with all non-revoked grants (revoked grants are hidden). */
export async function listVaultItems(clientId: string, kind: VaultItemKind, now = new Date()): Promise<VaultItemDto[]> {
  const items = await prisma.clientVaultItem.findMany({
    where: { clientId, kind },
    orderBy: { label: "asc" },
    include: { grants: { where: { revoked: false }, include: { user: { select: { name: true } } }, orderBy: { createdAt: "asc" } } },
  });
  return items.map((it) => ({
    id: it.id,
    clientId: it.clientId,
    kind: it.kind,
    label: it.label,
    url: it.url,
    username: it.username,
    notes: it.notes,
    hasPassword: !!it.passwordEnc,
    grants: it.grants.map((g) => ({
      id: g.id,
      userId: g.userId,
      userName: g.user.name,
      expiresAt: iso(g.expiresAt),
      expiresAfterFirstOpenMinutes: g.expiresAfterFirstOpenMinutes,
      firstOpenedAt: iso(g.firstOpenedAt),
      revoked: g.revoked,
      active: grantIsActive(g, now),
      effectiveExpiresAt: iso(grantExpiresAt(g)),
    })),
  }));
}

/** The user's own active grant on an item (null when none / expired / revoked). Admin bypasses this. */
export async function findActiveGrant(vaultItemId: string, userId: string, now = new Date()) {
  const g = await prisma.vaultAccessGrant.findUnique({ where: { vaultItemId_userId: { vaultItemId, userId } } });
  if (!g || !grantIsActive(g, now)) return null;
  return g;
}

export type GrantedItem = {
  id: string;
  label: string;
  url: string | null;
  username: string | null;
  notes: string | null;
  hasPassword: boolean;
  grant: Omit<GrantDto, "userId" | "userName">;
};
export type GrantedGroup = { clientId: string; clientName: string; kinds: { kind: VaultItemKind; items: GrantedItem[] }[] };

/** /vault view: only items with an active grant for this user, grouped by client then kind. */
export async function listGrantedItems(userId: string, now = new Date()): Promise<GrantedGroup[]> {
  const grants = await prisma.vaultAccessGrant.findMany({
    where: { userId, revoked: false },
    include: { vaultItem: { include: { client: { select: { id: true, name: true } } } } },
  });
  const byClient = new Map<string, GrantedGroup>();
  for (const g of grants) {
    if (!grantIsActive(g, now)) continue;
    const it = g.vaultItem;
    const group = byClient.get(it.clientId) ?? { clientId: it.clientId, clientName: it.client.name, kinds: [] };
    byClient.set(it.clientId, group);
    let kindGroup = group.kinds.find((k) => k.kind === it.kind);
    if (!kindGroup) {
      kindGroup = { kind: it.kind, items: [] };
      group.kinds.push(kindGroup);
    }
    kindGroup.items.push({
      id: it.id,
      label: it.label,
      url: it.url,
      username: it.username,
      notes: it.notes,
      hasPassword: !!it.passwordEnc,
      grant: {
        id: g.id,
        expiresAt: iso(g.expiresAt),
        expiresAfterFirstOpenMinutes: g.expiresAfterFirstOpenMinutes,
        firstOpenedAt: iso(g.firstOpenedAt),
        revoked: g.revoked,
        active: true,
        effectiveExpiresAt: iso(grantExpiresAt(g)),
      },
    });
  }
  const groups = Array.from(byClient.values()).sort((a, b) => a.clientName.localeCompare(b.clientName));
  for (const g of groups) {
    g.kinds.sort((a, b) => VAULT_KINDS.indexOf(a.kind) - VAULT_KINDS.indexOf(b.kind));
    for (const k of g.kinds) k.items.sort((a, b) => a.label.localeCompare(b.label));
  }
  return groups;
}
