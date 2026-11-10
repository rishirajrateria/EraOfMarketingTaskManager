"use server";
import { z } from "zod";
import { requireRole } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { parseInput } from "@/server/finance/schemas";
import {
  changeKitRoleCore, kitGeneralAccessCore, kitGeneralSchema, kitRemoveSchema, kitRoleSchema, kitScopeInput, kitShareSchema, loadKitSharing, removeKitAccessCore, resolveKitScope, shareKitCore,
  type KitShareResult, type KitSharing,
} from "@/server/clients/kit-share-core";

/**
 * Client kit Share sheet actions (ADR 0014): Admin only, zod-validated; the scope key is resolved against the
 * client's stored kit ids before any Drive call. Every change is audit-logged in the core.
 */
const clientIdSchema = z.string().trim().min(1, "Pick a client").max(64);

async function ctxFor(clientId: unknown, raw: unknown) {
  const actor = await requireRole("ADMIN");
  const id = parseInput(clientIdSchema, clientId);
  const { scope } = parseInput(kitScopeInput, raw);
  return { actor, ctx: await resolveKitScope(id, scope) };
}

/** Who has access to one part of the kit (`{ scope }`), plus the team directory for suggestions. */
export async function getKitSharing(clientId: unknown, raw: unknown): Promise<ActionResult<KitSharing>> {
  return wrap(async () => loadKitSharing((await ctxFor(clientId, raw)).ctx));
}

/** `{ scope, people: [{ email, role }], notify, message }` — each person gets their own access. */
export async function shareKit(clientId: unknown, raw: unknown): Promise<ActionResult<KitShareResult>> {
  return wrap(async () => {
    const { actor, ctx } = await ctxFor(clientId, raw);
    return shareKitCore(ctx, parseInput(kitShareSchema, raw), actor.id);
  });
}

export async function changeKitShareRole(clientId: unknown, raw: unknown): Promise<ActionResult<KitSharing>> {
  return wrap(async () => {
    const { actor, ctx } = await ctxFor(clientId, raw);
    return changeKitRoleCore(ctx, parseInput(kitRoleSchema, raw), actor.id);
  });
}

export async function removeKitShareAccess(clientId: unknown, raw: unknown): Promise<ActionResult<KitSharing>> {
  return wrap(async () => {
    const { actor, ctx } = await ctxFor(clientId, raw);
    return removeKitAccessCore(ctx, parseInput(kitRemoveSchema, raw), actor.id);
  });
}

export async function setKitGeneralAccess(clientId: unknown, raw: unknown): Promise<ActionResult<KitSharing>> {
  return wrap(async () => {
    const { actor, ctx } = await ctxFor(clientId, raw);
    return kitGeneralAccessCore(ctx, parseInput(kitGeneralSchema, raw), actor.id);
  });
}
