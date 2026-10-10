import type { Prisma, RecurrenceRule } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { lineAmount, round2 } from "@/server/finance/money";
import { effectiveGstPercent, splitTax, type DocType, type TaxMode } from "@/server/finance/tax";
import { isDraftNumber } from "@/server/finance/numbering";
import { D, FULL_INCLUDE, loadClientTax, loadInvoiceFull, singleRow, subtotalOf, type InvoiceFull, type ItemRow } from "@/server/finance/document-core";
import { itemRowsFor } from "@/server/finance/invoice-core";
import { loadPlan, partDescription, partPosition } from "@/server/finance/parts-core";
import { nextOccurrence } from "@/server/finance/recurrence";
import type { InvoiceInput, RecurrenceInput } from "@/server/finance/schemas";

/**
 * Edit a draft before approving it (owner request, prototype `editDraft`). Only documents still AWAITING_APPROVAL
 * with their `DRAFT-<id>` placeholder number and nothing sent can change; the number and public token are kept.
 * Tax is re-resolved from the (possibly new) client, so a client in another state switches CGST+SGST ↔ IGST.
 * Recurring drafts update their rule (nextRunAt recomputed when it changed); a part-payment draft edits only its
 * issued part (amount, due date, texts) and the plan total follows the new amount.
 */
type Tx = Prisma.TransactionClient;

export const EDIT_MESSAGES = {
  notFound: "Invoice not found",
  cancelled: "This invoice was cancelled, so it can't be edited.",
  creditNote: "Credit notes can't be edited. Delete this one and raise it again.",
  approved: "This invoice is already approved, so it can't be edited. Use a credit note or cancel it instead.",
  sent: "This invoice has already been sent, so it can't be edited.",
  notDraft: "Only drafts awaiting approval can be edited.",
  partPlan: "Part payments can't be changed to another plan here — delete the draft and create it again",
  toPart: "A draft can't be split into part payments here — delete the draft and create it again with Part payment",
  partClient: "Part payments can't be moved to another client here — delete the draft and create it again",
  partLines: "A part payment is billed as one amount — switch off line items",
  partProforma: "A proforma can't be split into parts — use one time or recurring",
  occurrencePlan: "This is one occurrence of a recurring invoice — use Stop recurrence instead of changing its plan",
  convertedProforma: "This invoice was converted from a proforma, so it stays a tax invoice",
} as const;

/** Refuse anything that was approved, numbered, sent or cancelled — with a message the owner can act on. */
export function assertEditableDraft(inv: Pick<InvoiceFull, "status" | "docType" | "approvedAt" | "number" | "sentAt" | "emailSentAt" | "whatsappSentAt">): void {
  if (inv.status === "CANCELLED") throw new Error(EDIT_MESSAGES.cancelled);
  if (inv.docType === "CREDIT_NOTE") throw new Error(EDIT_MESSAGES.creditNote);
  if (inv.approvedAt || !isDraftNumber(inv.number)) throw new Error(EDIT_MESSAGES.approved);
  if (inv.sentAt || inv.emailSentAt || inv.whatsappSentAt) throw new Error(EDIT_MESSAGES.sent);
  if (inv.status !== "AWAITING_APPROVAL") throw new Error(EDIT_MESSAGES.notDraft);
}

type Snapshot = Record<string, unknown>;
const snapshot = (inv: InvoiceFull): Snapshot => ({
  clientId: inv.clientId,
  docType: inv.docType,
  taxMode: inv.taxMode,
  plan: inv.plan,
  subtotal: inv.subtotal.toNumber(),
  gstPercent: inv.gstPercent.toNumber(),
  total: inv.total.toNumber(),
  description: inv.description,
  dueDate: inv.dueDate,
  remindAt: inv.remindAt,
  currency: inv.currency,
  tdsApplicable: inv.tdsApplicable,
  items: inv.items.length,
  scheduleId: inv.scheduleId,
});

type DocFields = { clientId: string; docType: DocType; taxMode: TaxMode; placeOfSupply: string | null; gstPercent: number; items: ItemRow[] };

/** Conditional write (status still AWAITING_APPROVAL, not approved) + item replace; recomputes every amount. */
async function writeDraft(tx: Tx, id: string, doc: DocFields, data: Prisma.InvoiceUncheckedUpdateManyInput): Promise<void> {
  const gstPercent = effectiveGstPercent(doc.gstPercent, doc.taxMode);
  const subtotal = subtotalOf(doc.items);
  const t = splitTax(subtotal, gstPercent, doc.taxMode);
  const claimed = await tx.invoice.updateMany({
    where: { id, status: "AWAITING_APPROVAL", approvedAt: null, sentAt: null },
    data: {
      ...data,
      clientId: doc.clientId,
      docType: doc.docType,
      taxMode: doc.taxMode,
      placeOfSupply: doc.placeOfSupply,
      subtotal: D(subtotal),
      gstPercent: D(gstPercent),
      gstAmount: D(t.gstAmount),
      cgstAmount: D(t.cgst),
      sgstAmount: D(t.sgst),
      igstAmount: D(t.igst),
      total: D(t.total),
      pdfData: null, // a draft never keeps a rendered PDF; the preview is rendered on demand
    },
  });
  if (claimed.count !== 1) throw new Error(EDIT_MESSAGES.approved);
  await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
  await tx.invoiceItem.createMany({
    data: doc.items.map((r, i) => ({ invoiceId: id, description: r.description, hsnSac: r.hsnSac, qty: D(r.qty), unit: r.unit, rate: D(r.rate), amount: D(r.amount), sortOrder: i })),
  });
}

function ruleData(r: RecurrenceInput) {
  return {
    frequency: r.frequency,
    interval: r.interval,
    byWeekday: r.byWeekday,
    monthAnchor: r.monthAnchor,
    dayOfMonth: r.monthAnchor === "DAY" ? (r.dayOfMonth ?? null) : null,
    notifyMinutes: r.notifyMinutes,
    endDate: r.endDate,
  };
}

/** True when the wizard's rule differs from the stored one (only then is nextRunAt recomputed). */
export function ruleChanged(stored: RecurrenceRule, r: RecurrenceInput): boolean {
  const next = ruleData(r);
  return (
    stored.frequency !== next.frequency ||
    stored.interval !== next.interval ||
    stored.byWeekday.join(",") !== next.byWeekday.join(",") ||
    stored.monthAnchor !== next.monthAnchor ||
    (stored.dayOfMonth ?? null) !== next.dayOfMonth ||
    stored.notifyMinutes !== next.notifyMinutes ||
    (stored.endDate?.getTime() ?? null) !== (next.endDate?.getTime() ?? null)
  );
}

/** Create / update / drop the recurrence rule for the edited plan. Returns the scheduleId to store + a rule to delete. */
async function syncSchedule(tx: Tx, inv: InvoiceFull, input: InvoiceInput, tz: string, now: Date): Promise<{ scheduleId: string | null; dropRuleId: string | null }> {
  if (input.plan !== "RECURRING" || !input.recurrence) return { scheduleId: null, dropRuleId: inv.scheduleId };
  const r = input.recurrence;
  if (!inv.scheduleId) {
    const rule = await tx.recurrenceRule.create({ data: { ...ruleData(r), trigger: "ON_SCHEDULE", nextRunAt: nextOccurrence(now, r, tz) } });
    return { scheduleId: rule.id, dropRuleId: null };
  }
  const stored = inv.schedule ?? (await tx.recurrenceRule.findUniqueOrThrow({ where: { id: inv.scheduleId } }));
  if (ruleChanged(stored, r)) await tx.recurrenceRule.update({ where: { id: stored.id }, data: { ...ruleData(r), nextRunAt: nextOccurrence(now, r, tz) } });
  return { scheduleId: stored.id, dropRuleId: null };
}

async function assertPlanChange(inv: InvoiceFull, input: InvoiceInput): Promise<void> {
  if (inv.plan === input.plan) return;
  if (inv.plan === "PART") throw new Error(EDIT_MESSAGES.partPlan);
  if (input.plan === "PART") throw new Error(EDIT_MESSAGES.toPart);
  if (inv.plan === "RECURRING" && inv.scheduleId) {
    const others = await prisma.invoice.count({ where: { scheduleId: inv.scheduleId, id: { not: inv.id } } });
    if (others > 0) throw new Error(EDIT_MESSAGES.occurrencePlan);
  }
}

/** One-time / recurring drafts (tax, export or proforma): everything can change; tax follows the client. */
async function updateWholeDraft(inv: InvoiceFull, input: InvoiceInput, now: Date): Promise<void> {
  const { client, company, tax } = await loadClientTax(input.clientId, input.docType ?? null);
  if (tax.docType === "PROFORMA" && inv.proformaOfId) throw new Error(EDIT_MESSAGES.convertedProforma);
  const rows = itemRowsFor(input);
  await prisma.$transaction(async (tx) => {
    const { scheduleId, dropRuleId } = await syncSchedule(tx, inv, input, company.timezone, now);
    await writeDraft(
      tx,
      inv.id,
      { clientId: client.id, docType: tax.docType, taxMode: tax.taxMode, placeOfSupply: tax.placeOfSupply, gstPercent: input.gstPercent ?? company.defaultGstPercent, items: rows },
      {
        plan: input.plan,
        kind: input.plan === "RECURRING" ? "RECURRING" : "ONE_TIME",
        scheduleId,
        description: input.description,
        dueDate: input.dueDate,
        notes: input.notes,
        paymentTerms: input.paymentTerms ?? company.invoiceTerms,
        tdsApplicable: input.tdsApplicable ?? client.tdsPercent != null,
        currency: client.country.toUpperCase() === "IN" ? "INR" : (input.currency ?? client.currency ?? "INR").toUpperCase(),
        remindAt: input.plan === "RECURRING" ? null : (input.remindAt ?? null),
      },
    );
    if (dropRuleId && (await tx.invoice.count({ where: { scheduleId: dropRuleId } })) === 0) await tx.recurrenceRule.delete({ where: { id: dropRuleId } });
  });
}

/** A part-payment draft: the issued part's amount / due date / texts; the plan total moves by the difference. */
async function updatePartDraft(inv: InvoiceFull, input: InvoiceInput): Promise<void> {
  if (input.clientId !== inv.clientId) throw new Error(EDIT_MESSAGES.partClient);
  if (input.docType === "PROFORMA") throw new Error(EDIT_MESSAGES.partProforma);
  const lines = input.items ?? [];
  if (lines.length > 1) throw new Error(EDIT_MESSAGES.partLines);
  if (!inv.planId || inv.partSeq == null) throw new Error("Payment plan not found");
  const plan = await loadPlan(inv.planId);
  if (plan.status !== "ACTIVE") throw new Error("Payment plan is not active");
  const part = plan.parts.find((p) => p.seq === inv.partSeq);
  if (!part) throw new Error(`Part ${inv.partSeq} not found`);
  const amount = round2(lines.length === 1 ? lineAmount(lines[0]) : (input.amount ?? 0));
  const delta = round2(amount - part.amount.toNumber());
  const current = inv.items[0];
  const description =
    lines.length === 1 ? lines[0].description : delta === 0 && current ? current.description : partDescription(plan, { kind: "FIXED", value: D(amount), description: part.description }, partPosition(plan.parts, part.seq));
  const { client, company, tax } = await loadClientTax(inv.clientId);
  const gstPercent = input.gstPercent ?? plan.gstPercent.toNumber();
  const dueDate = input.dueDate ?? part.dueDate;
  await prisma.$transaction(async (tx) => {
    await writeDraft(
      tx,
      inv.id,
      { clientId: client.id, docType: tax.docType, taxMode: tax.taxMode, placeOfSupply: tax.placeOfSupply, gstPercent, items: singleRow(description, amount, lines[0]?.hsnSac ?? current?.hsnSac ?? null) },
      {
        description: input.description,
        dueDate,
        notes: input.notes,
        paymentTerms: input.paymentTerms ?? company.invoiceTerms,
        tdsApplicable: input.tdsApplicable ?? client.tdsPercent != null,
        currency: client.country.toUpperCase() === "IN" ? "INR" : (input.currency ?? client.currency ?? "INR").toUpperCase(),
        remindAt: input.remindAt ?? null,
      },
    );
    await tx.invoicePart.update({ where: { id: part.id }, data: delta === 0 ? { dueDate } : { kind: "FIXED", value: D(amount), amount: D(amount), dueDate } });
    await tx.invoicePlan.update({ where: { id: plan.id }, data: { totalAmount: D(plan.totalAmount.toNumber() + delta), gstPercent: D(gstPercent) } });
  });
}

/** Core of `updateDraftInvoice` (no auth — the action checks Admin). Returns the refreshed draft. */
export async function updateDraftCore(id: string, input: InvoiceInput, actorId: string | null, now: Date = new Date()): Promise<InvoiceFull> {
  const inv = await loadInvoiceFull(id);
  if (!inv) throw new Error(EDIT_MESSAGES.notFound);
  assertEditableDraft(inv);
  await assertPlanChange(inv, input);
  if (inv.plan === "PART") await updatePartDraft(inv, input);
  else await updateWholeDraft(inv, input, now);
  const updated = await prisma.invoice.findUniqueOrThrow({ where: { id }, include: FULL_INCLUDE });
  await audit(actorId, "invoice.update_draft", "Invoice", id, snapshot(inv), snapshot(updated));
  return updated;
}
