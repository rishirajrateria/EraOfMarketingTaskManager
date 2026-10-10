"use server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, requireUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { createInvoiceRecord } from "@/server/finance/invoice-core";
import { approveAndSendCore, type ApproveResult } from "@/server/finance/approve-core";
import { issuePartCore, mergeRemainingPartsCore, updatePartScheduleCore } from "@/server/finance/parts-core";
import { convertProformaCore, createCreditNoteCore } from "@/server/finance/credit-notes";
import { holdWorkCore, resumeWorkCore, type HoldResult, type ResumeResult } from "@/server/finance/hold-work";
import { sendReminderCore } from "@/server/finance/reminder-core";
import { assertCancellableDocType, cancelInvoiceCore, type CancelResult } from "@/server/finance/cancel-core";
import { approveOptionsSchema, cancelInvoiceSchema, creditNoteInputSchema, dateInput, invoiceInputSchema, mergePartsSchema, parseInput, partScheduleSchema } from "@/server/finance/schemas";

/** Invoicing v2 server actions (ADR 0005). All mutations are ADMIN-only; nothing here sends without approval. */
const LIST = "/admin/invoices";
const paths = (id: string) => [LIST, `${LIST}/${id}`, "/admin/finance", "/admin/payments"];

async function requireWrite() {
  const u = await requireUser();
  if (!can.financeWrite(u)) throw new ForbiddenError("Only Admin can manage invoices");
  return u;
}

export type CreateInvoiceResult = { id: string; number: string; status: string; total: number; planId: string | null };

/** Create a document (tax / export / proforma; one-time, recurring or the first part of a plan) as AWAITING_APPROVAL. */
export async function createInvoice(raw: unknown): Promise<ActionResult<CreateInvoiceResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const input = parseInput(invoiceInputSchema, raw);
    const inv = await createInvoiceRecord(input, actor.id);
    safeRevalidate(...paths(inv.id));
    return { id: inv.id, number: inv.number, status: inv.status, total: inv.total.toNumber(), planId: inv.planId };
  });
}

/** Confirm sheet: allocate the number, render + store the PDF, email and/or WhatsApp it. */
export async function approveAndSend(id: string, rawOpts: unknown): Promise<ActionResult<ApproveResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const opts = parseInput(approveOptionsSchema, rawOpts ?? {});
    const res = await approveAndSendCore(id, opts, actor.id);
    safeRevalidate(...paths(id));
    return res;
  });
}

/** "Push forward": remind Admin to approve / send on a later date (job notifies INVOICE_APPROVAL_DUE). */
export async function pushForward(id: string, remindAtRaw: unknown): Promise<ActionResult<{ remindAt: string }>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const remindAt = parseInput(dateInput, remindAtRaw);
    if (remindAt.getTime() <= Date.now()) throw new Error("Reminder date must be in the future");
    const inv = await prisma.invoice.findUnique({ where: { id }, select: { status: true, remindAt: true } });
    if (!inv) throw new Error("Invoice not found");
    if (inv.status === "PAID" || inv.status === "CANCELLED") throw new Error("Settled documents cannot be pushed forward");
    await prisma.invoice.update({ where: { id }, data: { remindAt } });
    await audit(actor.id, "invoice.push_forward", "Invoice", id, { remindAt: inv.remindAt }, { remindAt });
    safeRevalidate(...paths(id));
    return { remindAt: remindAt.toISOString() };
  });
}

export type PartIssueResult = { id: string; number: string; status: string; seq: number | null };

/** Issue a pending part of a payment plan early. */
export async function issuePart(planId: string, seq: number): Promise<ActionResult<PartIssueResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const inv = await issuePartCore(planId, Number(seq), actor.id);
    safeRevalidate(...paths(inv.id));
    return { id: inv.id, number: inv.number, status: inv.status, seq: inv.partSeq };
  });
}

/** Fold the remaining pending parts into one invoice with a single due date. */
export async function mergeRemainingParts(planId: string, raw: unknown): Promise<ActionResult<PartIssueResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const input = parseInput(mergePartsSchema, raw);
    const inv = await mergeRemainingPartsCore(planId, input, actor.id);
    safeRevalidate(...paths(inv.id));
    return { id: inv.id, number: inv.number, status: inv.status, seq: inv.partSeq };
  });
}

/** Re-schedule the pending parts (amounts must still add up to the plan total). */
export async function updatePartSchedule(planId: string, raw: unknown): Promise<ActionResult<{ parts: { seq: number; amount: number; status: string }[] }>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const parts = parseInput(partScheduleSchema, raw);
    const plan = await updatePartScheduleCore(planId, parts, actor.id);
    safeRevalidate(LIST, "/admin/finance", "/admin/payments");
    return { parts: plan.parts.map((p) => ({ seq: p.seq, amount: p.amount.toNumber(), status: p.status })) };
  });
}

/** Proforma → tax / export invoice (AWAITING_APPROVAL), both linked. */
export async function convertProforma(id: string): Promise<ActionResult<{ id: string; number: string; status: string }>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const inv = await convertProformaCore(id, actor.id);
    safeRevalidate(...paths(id), `${LIST}/${inv.id}`);
    return { id: inv.id, number: inv.number, status: inv.status };
  });
}

/** Credit note against an approved invoice (AWAITING_APPROVAL; approving it applies the credit). */
export async function createCreditNote(invoiceId: string, raw: unknown): Promise<ActionResult<{ id: string; number: string; status: string; total: number }>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const input = parseInput(creditNoteInputSchema, raw);
    const cn = await createCreditNoteCore(invoiceId, input, actor.id);
    safeRevalidate(...paths(invoiceId), `${LIST}/${cn.id}`);
    return { id: cn.id, number: cn.number, status: cn.status, total: cn.total.toNumber() };
  });
}

/** Pause every open task of the client until the invoice is paid; notifies assignees + team leaders. */
export async function holdWork(clientId: string, invoiceId: string): Promise<ActionResult<HoldResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const res = await holdWorkCore(clientId, invoiceId, actor.id);
    safeRevalidate(...paths(invoiceId), "/dashboard", "/admin/clients");
    return res;
  });
}

export async function resumeWork(clientId: string): Promise<ActionResult<ResumeResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const res = await resumeWorkCore(clientId, actor.id);
    safeRevalidate(LIST, "/dashboard", "/admin/clients");
    return res;
  });
}

export type ReminderView = { reminderSentAt: string; reminderCount: number; balance: number; emailed: boolean; whatsapped: boolean };

/** Manual reminder for SENT / PARTIALLY_PAID / OVERDUE invoices: email + WhatsApp with the PDF. */
export async function sendReminder(id: string): Promise<ActionResult<ReminderView>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const r = await sendReminderCore(id, actor.id);
    safeRevalidate(...paths(id));
    return { reminderSentAt: r.reminderSentAt.toISOString(), reminderCount: r.reminderCount, balance: r.balance, emailed: r.emailed, whatsapped: r.whatsapped };
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

/**
 * Unapproved documents can be deleted; numbered ones are immutable (the series stays gap-free). A proforma is not a
 * record (ADR 0013), so it can be deleted at any time unless it was converted into a tax invoice (the link is kept).
 */
export async function deleteInvoice(id: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const inv = await prisma.invoice.findUnique({ where: { id }, select: { status: true, number: true, approvedAt: true, planId: true, docType: true, convertedTo: { select: { id: true } } } });
    if (!inv) throw new Error("Invoice not found");
    const freeProforma = inv.docType === "PROFORMA" && !inv.convertedTo;
    if (inv.docType === "PROFORMA" && inv.convertedTo) throw new Error("This proforma was converted into a tax invoice; it stays linked to it");
    if (!freeProforma && (inv.approvedAt || (inv.status !== "DRAFT" && inv.status !== "AWAITING_APPROVAL"))) throw new Error("Only unapproved documents can be deleted");
    await prisma.$transaction([
      prisma.invoicePart.updateMany({ where: { invoiceId: id }, data: { status: "PENDING", invoiceId: null } }),
      prisma.invoice.delete({ where: { id } }),
    ]);
    await audit(actor.id, "invoice.delete", "Invoice", id, { number: inv.number, status: inv.status }, null);
    safeRevalidate(LIST, "/admin/finance", "/admin/payments");
    return undefined;
  });
}

/**
 * ADR 0009: cancel a SENT / OVERDUE invoice with no payments or credit notes. The number stays used; the next
 * approval continues the series. Optional email / WhatsApp notice to the client.
 */
export async function cancelInvoice(id: string, raw: unknown): Promise<ActionResult<CancelResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    await assertCancellableDocType(id); // ADR 0013: proformas get a clear "cannot be cancelled" before form checks
    const opts = parseInput(cancelInvoiceSchema, raw);
    const res = await cancelInvoiceCore(id, opts, actor.id);
    safeRevalidate(...paths(id), "/admin/drive-folders", "/dashboard");
    return res;
  });
}
