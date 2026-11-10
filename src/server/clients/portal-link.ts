"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { safeRevalidate } from "@/lib/revalidate";
import { sendMail } from "@/google/gmail";
import { parseInput } from "@/server/finance/schemas";
import { portalBaseUrl } from "@/server/portal/base-url";
import { ensurePortalToken, newPortalToken, portalMessage } from "@/server/portal/portal";

/**
 * Admin's side of the client tracking link (prototype `trackerSheet`): read the link (made on first use), make a new
 * one (the old link stops working), and email it from the default sender. WhatsApp goes through a wa.me deep link
 * built in the browser from `whatsapp` and the message returned here.
 */
const clientIdSchema = z.string().trim().min(1, "Pick a client").max(64);
const emailSchema = z.object({ text: z.string().trim().min(1, "Write a message").max(3000).optional().nullable() });

export type PortalLink = { url: string; clientName: string; email: string | null; whatsapp: string | null; messages: { email: string; whatsapp: string } };

async function linkFor(clientId: string): Promise<PortalLink> {
  const token = await ensurePortalToken(clientId);
  const c = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { name: true, businessName: true, contact: true, email: true, whatsapp: true, phone: true } });
  const url = `${await portalBaseUrl()}/c/${token}`;
  const company = (await getSettings()).companyName;
  const clientName = c.businessName?.trim() || c.name;
  const greetName = c.contact && !c.contact.includes("@") ? c.contact.trim() : clientName;
  return {
    url,
    clientName,
    email: c.email?.trim() || null,
    whatsapp: c.whatsapp?.trim() || c.phone?.trim() || null,
    messages: { email: portalMessage({ channel: "EMAIL", greetName, company, url }), whatsapp: portalMessage({ channel: "WHATSAPP", greetName, company, url }) },
  };
}

/** The client's tracking link (made on first use) with the default send texts. Admin only. */
export async function getPortalLink(clientId: unknown): Promise<ActionResult<PortalLink>> {
  return wrap(async () => {
    await requireRole("ADMIN");
    return linkFor(parseInput(clientIdSchema, clientId));
  });
}

/** A new random token: the old link stops working at once. Admin only, audit-logged. */
export async function regeneratePortalLink(clientId: unknown): Promise<ActionResult<PortalLink>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const id = parseInput(clientIdSchema, clientId);
    await prisma.client.update({ where: { id }, data: { portalToken: newPortalToken() } });
    await audit(actor.id, "client.portal.regenerate", "Client", id, undefined, {});
    safeRevalidate(`/admin/client-kit/${id}`);
    return linkFor(id);
  });
}

/** Email the link to the client from the default sender (optional edited text). Admin only, audit-logged. */
export async function emailPortalLink(clientId: unknown, raw: unknown): Promise<ActionResult<{ to: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const id = parseInput(clientIdSchema, clientId);
    const input = parseInput(emailSchema, raw ?? {});
    const link = await linkFor(id);
    if (!link.email) throw new Error("This client has no email on file — add it on the client first");
    const company = (await getSettings()).companyName;
    await sendMail({ to: link.email, subject: `Track your work with ${company}`, text: input.text ?? link.messages.email });
    await audit(actor.id, "client.portal.send", "Client", id, undefined, { channel: "EMAIL", to: link.email });
    return { to: link.email };
  });
}
