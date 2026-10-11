import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { addPeople, listPermissions, removePermission, setLinkSharing, updateRole, type DrivePermission, type ShareRole } from "@/google/drive-share";
import { clientDisplayName } from "@/server/finance/file-names";
import { financeDriveOwner } from "@/server/finance/month-folders";
import { toPerson, type SharePerson } from "@/server/finance/drive-share-core";
import { kitFolderNames } from "@/server/clients/kit-paths";
import { KIT_SCOPE_KEYS, kitShareScopes, scopeOptions, scopeUrl, splitAccess, type KitScope, type KitScopeKey, type KitScopeOption, type TeamMember } from "@/server/clients/kit-share-scopes";

/**
 * Share sheet for a client kit (ADR 0014 "Sharing a kit"): pick the whole kit or one part (Brand kit, Credentials
 * sheet, Work, Reports), add people with their own Viewer / Commenter / Editor access, see who has access here and
 * who has it through the whole kit, and set link sharing per part. The scope is a key, resolved against the client's
 * stored kit ids — a Drive id from the browser is never used. Every change is audit-logged on the client.
 */
export type KitSharePerson = SharePerson & { inherited: boolean };
export type KitSharing = {
  clientId: string;
  scope: KitScopeKey;
  scopes: KitScopeOption[];
  title: string;
  name: string;
  url: string;
  owner: string | null;
  people: KitSharePerson[];
  general: { access: "restricted" | "anyone"; role: ShareRole };
  inheritedLink: ShareRole | null;
  /** Active internal users (names and role tags for rows; Team leaders and Executives become suggestions). */
  team: TeamMember[];
};

const roleSchema = z.enum(["reader", "commenter", "writer"]);
const scopeSchema = z.enum(KIT_SCOPE_KEYS, "Pick what to share");
const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));
export const kitScopeInput = z.object({ scope: scopeSchema });
export const kitShareSchema = z.object({
  scope: scopeSchema,
  people: z
    .array(z.object({ email: emailSchema, role: roleSchema }))
    .min(1, "Add at least one person")
    .max(25, "Add at most 25 people at a time")
    .refine((ps) => new Set(ps.map((p) => p.email)).size === ps.length, "Each person can be added once"),
  notify: z.boolean().default(true),
  message: z.string().trim().max(1000, "Keep the message under 1000 characters").optional().nullable(),
});
export const kitRoleSchema = z.object({ scope: scopeSchema, permissionId: z.string().trim().min(1).max(200), role: roleSchema });
export const kitRemoveSchema = z.object({ scope: scopeSchema, permissionId: z.string().trim().min(1).max(200) });
export const kitGeneralSchema = z.object({ scope: scopeSchema, access: z.enum(["restricted", "anyone"]), role: roleSchema.default("reader") });

type Ctx = { clientId: string; scope: KitScope; kit: KitScope; scopes: KitScope[] };

/** The client's kit part for this key; refuses clients without a kit and parts that were never created. */
export async function resolveKitScope(clientId: string, key: KitScopeKey): Promise<Ctx> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, businessName: true, kitFolderId: true, kitBrandId: true, kitCredentialsId: true, kitSheetId: true, kitWorkId: true, kitReportsId: true },
  });
  if (!client) throw new Error("Client not found");
  const scopes = kitShareScopes(client, kitFolderNames((await getSettings()).clientKitFolders), clientDisplayName(client));
  if (!scopes.length) throw new Error("Create the client kit first");
  const scope = scopes.find((s) => s.key === key);
  if (!scope) throw new Error("That part of the kit doesn't exist yet — tap Repair");
  return { clientId: client.id, scope, kit: scopes[0], scopes };
}

async function access(ctx: Ctx, owner: string | null) {
  const perms = await listPermissions(ctx.scope.fileId, owner);
  const kitPerms = ctx.scope.key === "kit" ? null : await listPermissions(ctx.kit.fileId, owner);
  return splitAccess(perms, kitPerms);
}

async function teamDirectory(): Promise<TeamMember[]> {
  const users = await prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true, role: true } });
  return users.map((u) => ({ ...u, email: u.email.toLowerCase() }));
}

const sortPeople = (a: KitSharePerson, b: KitSharePerson) =>
  Number(b.isOwner) - Number(a.isOwner) || Number(a.inherited) - Number(b.inherited) || (a.email ?? a.name ?? "").localeCompare(b.email ?? b.name ?? "");

export async function loadKitSharing(ctx: Ctx): Promise<KitSharing> {
  const owner = await financeDriveOwner();
  const [a, team] = await Promise.all([access(ctx, owner), teamDirectory()]);
  const people = [...a.direct.map((p) => ({ ...toPerson(p), inherited: false })), ...a.inherited.map((p) => ({ ...toPerson(p), isOwner: false, inherited: true }))].sort(sortPeople);
  const linkRole = a.link && (a.link.role === "reader" || a.link.role === "commenter" || a.link.role === "writer") ? a.link.role : "reader";
  return {
    clientId: ctx.clientId,
    scope: ctx.scope.key,
    scopes: scopeOptions(ctx.scopes),
    title: ctx.scope.label,
    name: ctx.scope.name,
    url: scopeUrl(ctx.scope),
    owner: people.find((p) => p.isOwner)?.email ?? owner,
    people,
    general: { access: a.link ? "anyone" : "restricted", role: linkRole },
    inheritedLink: a.inheritedLink,
    team,
  };
}

/** Only access set on this part can change here; the owner and "via whole kit" rows are read-only. */
async function editable(ctx: Ctx, permissionId: string): Promise<DrivePermission> {
  const a = await access(ctx, await financeDriveOwner());
  const perm = a.direct.find((p) => p.id === permissionId);
  if (!perm) {
    if (a.inherited.some((p) => p.id === permissionId)) throw new Error("That access comes from the whole kit — change it under Whole kit");
    throw new Error("That person no longer has access");
  }
  if (perm.role === "owner" || perm.role === "organizer") throw new Error("The owner's access can't be changed");
  return perm;
}

const where = (ctx: Ctx) => ({ scope: ctx.scope.key, name: ctx.scope.name, fileId: ctx.scope.fileId });

export type KitShareResult = { sharing: KitSharing; added: { email: string; role: ShareRole }[]; failed: { email: string; error: string }[] };

/** Each person gets their own role on the chosen part; Drive emails them when `notify` (with the message). */
export async function shareKitCore(ctx: Ctx, input: z.output<typeof kitShareSchema>, actorId: string): Promise<KitShareResult> {
  const owner = await financeDriveOwner();
  if (owner && input.people.some((p) => p.email === owner)) throw new Error(`${owner} owns this kit already`);
  const added: KitShareResult["added"] = [];
  const failed: KitShareResult["failed"] = [];
  for (const p of input.people) {
    const r = await addPeople(ctx.scope.fileId, [p.email], p.role, { notify: input.notify, message: input.message ?? null, owner });
    if (r.added.length) added.push({ email: p.email, role: p.role });
    failed.push(...r.failed);
  }
  await audit(actorId, "client.kit.share.add", "Client", ctx.clientId, undefined, { ...where(ctx), notify: input.notify, added, failed });
  if (!added.length) throw new Error(failed.map((f) => `${f.email}: ${f.error}`).join("; ") || "Nobody was added");
  return { sharing: await loadKitSharing(ctx), added, failed };
}

export async function changeKitRoleCore(ctx: Ctx, input: z.output<typeof kitRoleSchema>, actorId: string): Promise<KitSharing> {
  const perm = await editable(ctx, input.permissionId);
  await updateRole(ctx.scope.fileId, perm.id, input.role);
  await audit(actorId, "client.kit.share.role", "Client", ctx.clientId, { ...where(ctx), who: perm.emailAddress ?? perm.type, role: perm.role }, { role: input.role });
  return loadKitSharing(ctx);
}

export async function removeKitAccessCore(ctx: Ctx, input: z.output<typeof kitRemoveSchema>, actorId: string): Promise<KitSharing> {
  const perm = await editable(ctx, input.permissionId);
  await removePermission(ctx.scope.fileId, perm.id);
  await audit(actorId, "client.kit.share.remove", "Client", ctx.clientId, { ...where(ctx), who: perm.emailAddress ?? perm.type, role: perm.role }, null);
  return loadKitSharing(ctx);
}

export async function kitGeneralAccessCore(ctx: Ctx, input: z.output<typeof kitGeneralSchema>, actorId: string): Promise<KitSharing> {
  const owner = await financeDriveOwner();
  const before = await access(ctx, owner);
  // A part opened through the whole kit's link lists that (inherited) link too; changing it here would touch the kit's.
  if (before.inheritedLink && !before.link) throw new Error("The whole kit is open to anyone with the link — change it under Whole kit");
  await setLinkSharing(ctx.scope.fileId, input.access === "restricted" ? "restricted" : input.role, owner);
  await audit(actorId, "client.kit.share.link", "Client", ctx.clientId, { ...where(ctx), link: before.link?.role ?? "restricted" }, { access: input.access, role: input.role });
  return loadKitSharing(ctx);
}
