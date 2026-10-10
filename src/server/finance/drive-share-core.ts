import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { folderUrl } from "@/google/drive";
import { addPeople, listPermissions, removePermission, setLinkSharing, updateRole, type DrivePermission, type PermissionRole, type ShareRole } from "@/google/drive-share";
import { monthLabelLong } from "@/server/finance/gst-pack";
import { financeDriveOwner } from "@/server/finance/month-folders";

/**
 * Share sheet for the finance folders (ADR 0013). Only folders the app created and recorded — the Finance root
 * (FinanceDriveRoot) and each Finance/YYYY-MM folder (FinanceMonthFolder) — can be shared; a folder id from the
 * browser is looked up in the database and anything else is refused, so the sheet cannot be used to share
 * arbitrary files in the owner's Drive. Every change is audit-logged.
 */
export type SharePerson = { id: string; email: string | null; name: string | null; role: PermissionRole; isOwner: boolean; kind: DrivePermission["type"] };
export type FolderSharing = {
  folderId: string;
  title: string;
  url: string;
  owner: string | null;
  people: SharePerson[];
  general: { access: "restricted" | "anyone"; role: ShareRole };
};

export const FOREIGN_FOLDER_ERROR = "Only the Finance folders created by this app can be shared from here";

const roleSchema = z.enum(["reader", "commenter", "writer"]);
const folderIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{3,200}$/, "Not a Drive folder id");
export const shareInputSchema = z.object({
  emails: z.array(z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"))).min(1, "Add at least one email").max(25, "Add at most 25 people at a time"),
  role: roleSchema,
  notify: z.boolean().default(true),
  message: z.string().trim().max(1000, "Keep the message under 1000 characters").optional().nullable(),
});
export const roleChangeSchema = z.object({ permissionId: z.string().trim().min(1).max(200), role: roleSchema });
export const removeSchema = z.object({ permissionId: z.string().trim().min(1).max(200) });
export const generalSchema = z.object({ access: z.enum(["restricted", "anyone"]), role: roleSchema.default("reader") });

type Folder = { folderId: string; title: string };

/** The folder must be the Finance root or a month folder recorded in the database; never trust the browser's id. */
export async function resolveShareableFolder(rawId: unknown): Promise<Folder> {
  const parsed = folderIdSchema.safeParse(rawId);
  if (!parsed.success) throw new Error(FOREIGN_FOLDER_ERROR);
  const id = parsed.data;
  const [root, month] = await Promise.all([
    prisma.financeDriveRoot.findFirst({ where: { folderId: id }, select: { folderId: true } }),
    prisma.financeMonthFolder.findFirst({ where: { folderId: id }, select: { folderId: true, month: true } }),
  ]);
  if (root) return { folderId: root.folderId, title: "Finance" };
  if (month) return { folderId: month.folderId, title: `Finance › ${monthLabelLong(month.month)}` };
  throw new Error(FOREIGN_FOLDER_ERROR);
}

function toPerson(p: DrivePermission): SharePerson {
  const name = p.type === "domain" ? `Anyone at ${p.domain ?? "your organisation"}` : p.type === "group" ? (p.displayName ?? p.emailAddress) : p.displayName;
  return { id: p.id, email: p.emailAddress, name, role: p.role, isOwner: p.role === "owner", kind: p.type };
}

export async function loadSharing(folder: Folder): Promise<FolderSharing> {
  const owner = await financeDriveOwner();
  const perms = await listPermissions(folder.folderId, owner);
  const anyone = perms.find((p) => p.type === "anyone");
  const people = perms
    .filter((p) => p.type !== "anyone")
    .map(toPerson)
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || (a.email ?? a.name ?? "").localeCompare(b.email ?? b.name ?? ""));
  const linkRole: ShareRole = anyone && (anyone.role === "reader" || anyone.role === "commenter" || anyone.role === "writer") ? anyone.role : "reader";
  return {
    folderId: folder.folderId,
    title: folder.title,
    url: folderUrl(folder.folderId),
    owner: people.find((p) => p.isOwner)?.email ?? owner,
    people,
    general: { access: anyone ? "anyone" : "restricted", role: linkRole },
  };
}

/** The permission must exist on this folder and must not be the owner's (ownership is never changed here). */
async function editablePermission(folder: Folder, permissionId: string): Promise<DrivePermission> {
  const perm = (await listPermissions(folder.folderId, await financeDriveOwner())).find((p) => p.id === permissionId);
  if (!perm) throw new Error("That person no longer has access");
  if (perm.role === "owner" || perm.role === "organizer") throw new Error("The owner's access can't be changed");
  return perm;
}

export async function shareCore(folder: Folder, input: z.output<typeof shareInputSchema>, actorId: string) {
  const owner = await financeDriveOwner();
  if (owner && input.emails.includes(owner)) throw new Error(`${owner} owns this folder already`);
  const res = await addPeople(folder.folderId, input.emails, input.role, { notify: input.notify, message: input.message ?? null, owner });
  await audit(actorId, "drive.share.add", "DriveFolder", folder.folderId, undefined, { title: folder.title, role: input.role, notify: input.notify, added: res.added, failed: res.failed });
  if (res.added.length === 0) throw new Error(res.failed.map((f) => `${f.email}: ${f.error}`).join("; ") || "Nobody was added");
  return { sharing: await loadSharing(folder), added: res.added, failed: res.failed };
}

export async function changeRoleCore(folder: Folder, input: z.output<typeof roleChangeSchema>, actorId: string) {
  const perm = await editablePermission(folder, input.permissionId);
  await updateRole(folder.folderId, perm.id, input.role);
  await audit(actorId, "drive.share.role", "DriveFolder", folder.folderId, { who: perm.emailAddress ?? perm.type, role: perm.role }, { role: input.role });
  return loadSharing(folder);
}

export async function removeCore(folder: Folder, input: z.output<typeof removeSchema>, actorId: string) {
  const perm = await editablePermission(folder, input.permissionId);
  await removePermission(folder.folderId, perm.id);
  await audit(actorId, "drive.share.remove", "DriveFolder", folder.folderId, { who: perm.emailAddress ?? perm.type, role: perm.role }, null);
  return loadSharing(folder);
}

export async function generalAccessCore(folder: Folder, input: z.output<typeof generalSchema>, actorId: string) {
  const before = await loadSharing(folder);
  await setLinkSharing(folder.folderId, input.access === "restricted" ? "restricted" : input.role, await financeDriveOwner());
  await audit(actorId, "drive.share.link", "DriveFolder", folder.folderId, before.general, { access: input.access, role: input.role });
  return loadSharing(folder);
}
