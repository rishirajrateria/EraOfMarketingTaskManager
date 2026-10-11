"use server";
import { z } from "zod";
import { requireRole } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { parseInput } from "@/server/finance/schemas";
import { createKitCore, sendKitCore, sendKitSchema, type KitResult } from "@/server/clients/kit-core";

/** Client kit actions (ADR 0014): Admin only, zod-validated, audit-logged in the core. */
const clientIdSchema = z.string().trim().min(1, "Pick a client").max(64);
const done = (id: string) => safeRevalidate("/admin/client-kit", `/admin/client-kit/${id}`, "/admin/clients");

/** Create the kit, or repair a partial one (missing folders / sheet / sharing). Never duplicates. */
export async function createClientKit(clientId: unknown): Promise<ActionResult<KitResult>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const id = parseInput(clientIdSchema, clientId);
    const res = await createKitCore(id, actor.id);
    done(id);
    return res;
  });
}

/** Send the kit link with instructions by email or WhatsApp (optional edited text). */
export async function sendClientKit(clientId: unknown, raw: unknown): Promise<ActionResult<{ channel: "EMAIL" | "WHATSAPP"; to: string; sentAt: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const id = parseInput(clientIdSchema, clientId);
    const res = await sendKitCore(id, parseInput(sendKitSchema, raw), actor.id);
    done(id);
    return res;
  });
}
