"use server";
import { wrap, type ActionResult } from "@/lib/action-result";
import { requireFinanceActor } from "@/server/finance/guard";
import { parseInput } from "@/server/finance/schemas";
import {
  changeRoleCore, generalAccessCore, generalSchema, loadSharing, removeCore, removeSchema, resolveShareableFolder, roleChangeSchema, shareCore, shareInputSchema,
  type FolderSharing,
} from "@/server/finance/drive-share-core";

/**
 * Share sheet actions for the Finance / month folders (ADR 0013). ADMIN only, zod-validated; the folder id is looked
 * up in the database (Finance root or a recorded month folder) before any Drive call. Every change is audit-logged.
 */
export async function getFolderSharing(folderId: string): Promise<ActionResult<FolderSharing>> {
  return wrap(async () => {
    await requireFinanceActor("write");
    return loadSharing(await resolveShareableFolder(folderId));
  });
}

export async function shareFolder(folderId: string, raw: unknown): Promise<ActionResult<{ sharing: FolderSharing; added: string[]; failed: { email: string; error: string }[] }>> {
  return wrap(async () => {
    const actor = await requireFinanceActor("write");
    const folder = await resolveShareableFolder(folderId);
    return shareCore(folder, parseInput(shareInputSchema, raw), actor.id);
  });
}

export async function changeShareRole(folderId: string, raw: unknown): Promise<ActionResult<FolderSharing>> {
  return wrap(async () => {
    const actor = await requireFinanceActor("write");
    const folder = await resolveShareableFolder(folderId);
    return changeRoleCore(folder, parseInput(roleChangeSchema, raw), actor.id);
  });
}

export async function removeShareAccess(folderId: string, raw: unknown): Promise<ActionResult<FolderSharing>> {
  return wrap(async () => {
    const actor = await requireFinanceActor("write");
    const folder = await resolveShareableFolder(folderId);
    return removeCore(folder, parseInput(removeSchema, raw), actor.id);
  });
}

export async function setGeneralAccess(folderId: string, raw: unknown): Promise<ActionResult<FolderSharing>> {
  return wrap(async () => {
    const actor = await requireFinanceActor("write");
    const folder = await resolveShareableFolder(folderId);
    return generalAccessCore(folder, parseInput(generalSchema, raw), actor.id);
  });
}
