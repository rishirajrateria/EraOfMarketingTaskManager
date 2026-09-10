"use server";
import { z } from "zod";
import type { ClientVaultItem, VaultAccessGrant } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { encrypt, decrypt } from "@/lib/crypto";
import { requireRole, requireUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { grantExpiresAt, grantIsActive } from "@/server/vault/access";
import { findActiveGrant } from "@/server/vault/queries";

const ADMIN_PATH = "/admin/vault";
const VAULT_PATH = "/vault";

const optionalText = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const clientSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  contact: optionalText,
  email: z.string().trim().email().optional().nullable().or(z.literal("")).transform((v) => (v ? v : null)),
  gstNumber: optionalText,
  address: optionalText,
});

const itemSchema = z.object({
  clientId: z.string().min(1),
  kind: z.enum(["ASSET_DRIVE_LINK", "CREDENTIAL", "SHARED_DRIVE_LINK"]),
  label: z.string().trim().min(1, "Label is required").max(200),
  url: optionalText,
  username: optionalText,
  /** Plain-text password; encrypted before it touches the DB. `undefined` on update = keep existing. */
  password: z.string().max(4000).optional().nullable(),
  notes: optionalText,
});

const isoDate = z
  .string()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

const grantSchema = z
  .object({
    userIds: z.array(z.string().min(1)).min(1, "Pick at least one user"),
    itemId: z.string().min(1).optional(),
    clientId: z.string().min(1).optional(),
    expiresAt: isoDate,
    expiresAfterFirstOpenMinutes: z.number().int().positive().max(60 * 24 * 365).optional().nullable(),
  })
  .refine((v) => !!v.itemId || !!v.clientId, { message: "itemId or clientId is required" });

/** Audit-safe projection of an item — never includes the secret. */
function redactItem(it: ClientVaultItem | null) {
  if (!it) return undefined;
  return { id: it.id, clientId: it.clientId, kind: it.kind, label: it.label, url: it.url, username: it.username, notes: it.notes, hasPassword: !!it.passwordEnc };
}

function redactGrant(g: VaultAccessGrant | null) {
  if (!g) return undefined;
  return {
    id: g.id,
    vaultItemId: g.vaultItemId,
    userId: g.userId,
    expiresAt: g.expiresAt,
    expiresAfterFirstOpenMinutes: g.expiresAfterFirstOpenMinutes,
    firstOpenedAt: g.firstOpenedAt,
    revoked: g.revoked,
  };
}

// ---------- Clients (SPEC §11.1 header "+" = Add Client) ----------

export async function createClient(input: z.input<typeof clientSchema>): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const me = await requireRole("ADMIN");
    const data = clientSchema.parse(input);
    const client = await prisma.client.create({ data });
    await audit(me.id, "client.create", "Client", client.id, undefined, client);
    safeRevalidate(ADMIN_PATH, "/dashboard");
    return { id: client.id };
  });
}

// ---------- Items ----------

export async function createVaultItem(input: z.input<typeof itemSchema>): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const me = await requireRole("ADMIN");
    const { password, ...data } = itemSchema.parse(input);
    const item = await prisma.clientVaultItem.create({ data: { ...data, passwordEnc: password ? encrypt(password) : null } });
    await audit(me.id, "vault.item.create", "ClientVaultItem", item.id, undefined, redactItem(item));
    safeRevalidate(ADMIN_PATH, VAULT_PATH);
    return { id: item.id };
  });
}

export async function updateVaultItem(itemId: string, input: Partial<z.input<typeof itemSchema>>): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const me = await requireRole("ADMIN");
    const before = await prisma.clientVaultItem.findUniqueOrThrow({ where: { id: itemId } });
    const { password, ...data } = itemSchema.partial().parse(input);
    // undefined = keep; "" or null = clear; string = replace
    const passwordEnc = password === undefined ? undefined : password ? encrypt(password) : null;
    const item = await prisma.clientVaultItem.update({ where: { id: itemId }, data: { ...data, passwordEnc } });
    await audit(me.id, "vault.item.update", "ClientVaultItem", item.id, redactItem(before), redactItem(item));
    safeRevalidate(ADMIN_PATH, VAULT_PATH);
    return { id: item.id };
  });
}

export async function deleteVaultItem(itemId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const me = await requireRole("ADMIN");
    const before = await prisma.clientVaultItem.findUniqueOrThrow({ where: { id: itemId } });
    await prisma.clientVaultItem.delete({ where: { id: itemId } }); // grants + view logs cascade
    await audit(me.id, "vault.item.delete", "ClientVaultItem", itemId, redactItem(before), undefined);
    safeRevalidate(ADMIN_PATH, VAULT_PATH);
    return undefined;
  });
}

// ---------- Grants ----------

/**
 * Grant access to one item (`itemId`) or to every current item of a client (`clientId`).
 * "Per client" is implemented as one grant per existing item; items added to the client later are NOT
 * covered automatically — Admin re-runs the per-client grant to include them.
 * Re-granting an existing (even revoked/expired) user+item pair resets it to the new terms.
 */
export async function grantAccess(input: z.input<typeof grantSchema>): Promise<ActionResult<{ grants: number }>> {
  return wrap(async () => {
    const me = await requireRole("ADMIN");
    const data = grantSchema.parse(input);
    const items = data.itemId
      ? await prisma.clientVaultItem.findMany({ where: { id: data.itemId } })
      : await prisma.clientVaultItem.findMany({ where: { clientId: data.clientId! } });
    if (items.length === 0) throw new Error("No vault items to grant");
    const users = await prisma.user.findMany({ where: { id: { in: data.userIds }, active: true }, select: { id: true } });
    if (users.length === 0) throw new Error("No active users selected");

    let count = 0;
    for (const item of items) {
      for (const u of users) {
        const before = await prisma.vaultAccessGrant.findUnique({ where: { vaultItemId_userId: { vaultItemId: item.id, userId: u.id } } });
        const terms = { expiresAt: data.expiresAt, expiresAfterFirstOpenMinutes: data.expiresAfterFirstOpenMinutes ?? null };
        const grant = await prisma.vaultAccessGrant.upsert({
          where: { vaultItemId_userId: { vaultItemId: item.id, userId: u.id } },
          create: { vaultItemId: item.id, userId: u.id, grantedById: me.id, ...terms },
          update: { ...terms, grantedById: me.id, revoked: false, firstOpenedAt: null, expiringNotifiedAt: null },
        });
        await audit(me.id, "vault.grant", "VaultAccessGrant", grant.id, redactGrant(before), redactGrant(grant));
        count++;
      }
    }
    const clientName = (await prisma.client.findUnique({ where: { id: items[0]!.clientId }, select: { name: true } }))?.name ?? "a client";
    await notify({
      userIds: users.map((u) => u.id),
      kind: "VAULT_ACCESS_GRANTED",
      title: "Vault access granted",
      body: data.itemId ? `${items[0]!.label} (${clientName})` : `${items.length} item(s) for ${clientName}`,
      href: VAULT_PATH,
    });
    safeRevalidate(ADMIN_PATH, VAULT_PATH);
    return { grants: count };
  });
}

export async function revokeGrant(grantId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const me = await requireRole("ADMIN");
    const before = await prisma.vaultAccessGrant.findUniqueOrThrow({ where: { id: grantId } });
    const after = await prisma.vaultAccessGrant.update({ where: { id: grantId }, data: { revoked: true } });
    await audit(me.id, "vault.revoke", "VaultAccessGrant", grantId, redactGrant(before), redactGrant(after));
    safeRevalidate(ADMIN_PATH, VAULT_PATH);
    return undefined;
  });
}

// ---------- Reveal (the only place a secret is decrypted) ----------

export type RevealResult = {
  password: string | null;
  /** Grant state after this open (null for Admin, who needs no grant). */
  grant: { firstOpenedAt: string | null; expiresAt: string | null; expiresAfterFirstOpenMinutes: number | null; effectiveExpiresAt: string | null } | null;
};

/**
 * Decrypts an item's password for the caller. Admin always may; everyone else needs an active grant.
 * First open starts the after-first-open clock. Every reveal writes a VaultViewLog and an audit row
 * (action "vault.reveal") — the secret itself is never written anywhere.
 */
export async function revealSecret(itemId: string): Promise<ActionResult<RevealResult>> {
  return wrap(async () => {
    const me = await requireUser();
    const now = new Date();
    const item = await prisma.clientVaultItem.findUnique({ where: { id: itemId } });
    if (!item) throw new ForbiddenError("No access to this item");

    let grant: VaultAccessGrant | null = null;
    if (me.role !== "ADMIN") {
      grant = await findActiveGrant(itemId, me.id, now);
      if (!grant) throw new ForbiddenError("No access to this item");
      if (!grant.firstOpenedAt) {
        grant = await prisma.vaultAccessGrant.update({ where: { id: grant.id }, data: { firstOpenedAt: now } });
      }
      // Re-check: the window must still be open after starting the clock (defensive for tiny windows).
      if (!grantIsActive(grant, now)) throw new ForbiddenError("Access expired");
    }

    await prisma.vaultViewLog.create({ data: { vaultItemId: itemId, userId: me.id, viewedAt: now } });
    await audit(me.id, "vault.reveal", "ClientVaultItem", itemId, undefined, { userId: me.id, grantId: grant?.id ?? null, clientId: item.clientId, label: item.label });

    return {
      password: item.passwordEnc ? decrypt(item.passwordEnc) : null,
      grant: grant
        ? {
            firstOpenedAt: grant.firstOpenedAt?.toISOString() ?? null,
            expiresAt: grant.expiresAt?.toISOString() ?? null,
            expiresAfterFirstOpenMinutes: grant.expiresAfterFirstOpenMinutes,
            effectiveExpiresAt: grantExpiresAt(grant)?.toISOString() ?? null,
          }
        : null,
    };
  });
}
