"use server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, requireUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { createInvoiceRecord, generateBalanceInvoiceCore, sendInvoiceCore } from "@/server/finance/invoice-core";
import { dateInput, invoiceInputSchema, parseInput } from "@/server/finance/schemas";

/** Payment Creator server actions (SPEC §11.3). All mutations are ADMIN-only. */
const LIST = "/admin/invoices";
const paths = (id: string) => [LIST, `${LIST}/${id}`, "/admin/finance"];

async function requireWrite() {
  const u = await requireUser();
  if (!can.financeWrite(u)) throw new ForbiddenError("Only Admin can manage invoices");
  return u;
}

export type CreateInvoiceResult = { id: string; number: string; status: string; total: number };

export async function createInvoice(raw: unknown): Promise<ActionResult<CreateInvoiceResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const input = parseInput(invoiceInputSchema.extend({ sendNow: z.boolean().optional() }), raw);
    let inv = await createInvoiceRecord(input, actor.id);
    if (input.sendNow) inv = await sendInvoiceCore(inv.id, actor.id);
    safeRevalidate(...paths(inv.id));
    return { id: inv.id, number: inv.number, status: inv.status, total: inv.total.toNumber() };
  });
}

/** "Send now": PDF + Drive + Gmail, status SENT. */
export async function sendInvoice(id: string): Promise<ActionResult<{ status: string }>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const inv = await sendInvoiceCore(id, actor.id);
    safeRevalidate(...paths(id));
    return { status: inv.status };
  });
}

/** Schedule (or reschedule) sending at a date/time → status SCHEDULED; the invoices job sends it. */
export async function scheduleInvoice(id: string, sendAtRaw: unknown): Promise<ActionResult<{ status: string }>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const sendAt = parseInput(dateInput, sendAtRaw);
    const inv = await prisma.invoice.findUnique({ where: { id }, select: { status: true } });
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "DRAFT" && inv.status !== "SCHEDULED") throw new Error("Only draft invoices can be scheduled");
    await prisma.invoice.update({ where: { id }, data: { sendAt, status: "SCHEDULED" } });
    await audit(actor.id, "invoice.schedule", "Invoice", id, { status: inv.status }, { status: "SCHEDULED", sendAt });
    safeRevalidate(...paths(id));
    return { status: "SCHEDULED" };
  });
}

/** Advance invoices with "balance on completion": Admin generates (and sends) the balance invoice. */
export async function generateBalanceInvoice(advanceId: string): Promise<ActionResult<{ id: string; number: string }>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const inv = await generateBalanceInvoiceCore(advanceId, actor.id, true);
    safeRevalidate(...paths(advanceId), `${LIST}/${inv.id}`);
    return { id: inv.id, number: inv.number };
  });
}

export async function stopRecurrence(invoiceId: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { scheduleId: true } });
    if (!inv?.scheduleId) throw new Error("Invoice has no recurrence");
    await prisma.recurrenceRule.update({ where: { id: inv.scheduleId }, data: { stopped: true } });
    await audit(actor.id, "invoice.recurrence_stop", "Invoice", invoiceId, { stopped: false }, { stopped: true });
    safeRevalidate(...paths(invoiceId));
    return undefined;
  });
}

/** Drafts and scheduled invoices can be deleted; sent invoices are immutable (numbering stays gap-free). */
export async function deleteInvoice(id: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const inv = await prisma.invoice.findUnique({ where: { id }, select: { status: true, number: true, balanceInvoice: { select: { id: true } } } });
    if (!inv) throw new Error("Invoice not found");
    if (inv.status !== "DRAFT" && inv.status !== "SCHEDULED") throw new Error("Only draft or scheduled invoices can be deleted");
    if (inv.balanceInvoice) throw new Error("Delete the balance invoice first");
    await prisma.invoice.delete({ where: { id } });
    await audit(actor.id, "invoice.delete", "Invoice", id, { number: inv.number, status: inv.status }, null);
    safeRevalidate(LIST, "/admin/finance");
    return undefined;
  });
}
