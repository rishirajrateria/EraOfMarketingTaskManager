import { prisma } from "@/lib/db";
import { insertDocument, loadClientTax, rowsFromInput, rowsFromModel, singleRow, subtotalOf, type InvoiceFull } from "@/server/finance/document-core";
import { createPlan, issuePartCore, resolveParts } from "@/server/finance/parts-core";
import { nextOccurrence, shiftedDueDate } from "@/server/finance/recurrence";
import type { InvoiceInput } from "@/server/finance/schemas";

/**
 * Invoice creation (ADR 0005). Documents are never sent from here: every result is AWAITING_APPROVAL with a
 * `DRAFT-<id>` number; `approveAndSend` allocates the series number and delivers it.
 */
export { loadCompany, loadInvoiceFull, renderInvoiceBuffer, toPdfInvoice, type InvoiceFull } from "@/server/finance/document-core";

export function itemRowsFor(input: Pick<InvoiceInput, "items" | "amount" | "description" | "hsnSac">) {
  if (input.items && input.items.length > 0) return rowsFromInput(input.items);
  return singleRow(input.description || "Services", input.amount ?? 0, input.hsnSac ?? null);
}

export async function createInvoiceRecord(input: InvoiceInput, actorId: string): Promise<InvoiceFull> {
  const { client, company, tax } = await loadClientTax(input.clientId, input.docType ?? null);
  const gstPercent = input.gstPercent ?? company.defaultGstPercent;
  const rows = itemRowsFor(input);
  const base = {
    clientId: client.id,
    docType: tax.docType,
    taxMode: tax.taxMode,
    placeOfSupply: tax.placeOfSupply,
    gstPercent,
    items: rows,
    description: input.description,
    dueDate: input.dueDate,
    notes: input.notes,
    paymentTerms: input.paymentTerms ?? company.invoiceTerms,
    tdsApplicable: input.tdsApplicable ?? client.tdsPercent != null,
  };

  if (input.plan === "PART") {
    if (tax.docType === "PROFORMA") throw new Error("A proforma cannot be split into parts");
    const parts = resolveParts(input.parts ?? [], subtotalOf(rows));
    const plan = await prisma.$transaction((tx) =>
      createPlan(tx, {
        clientId: client.id,
        title: rows.length === 1 ? rows[0].description : input.description || `${rows.length} items`,
        description: input.description,
        totalAmount: subtotalOf(rows),
        gstPercent,
        parts,
        createdById: actorId,
      }),
    );
    return issuePartCore(plan.id, parts[0].seq, actorId, { description: input.description, tdsApplicable: base.tdsApplicable });
  }

  const now = new Date();
  return prisma.$transaction(async (tx) => {
    let scheduleId: string | undefined;
    if (input.plan === "RECURRING" && input.recurrence) {
      const r = input.recurrence;
      const rule = await tx.recurrenceRule.create({
        data: { frequency: r.frequency, interval: r.interval, byWeekday: r.byWeekday, monthAnchor: r.monthAnchor, endDate: r.endDate, trigger: "ON_SCHEDULE", nextRunAt: nextOccurrence(now, r, company.timezone) },
      });
      scheduleId = rule.id;
    }
    return insertDocument(tx, { ...base, plan: input.plan, scheduleId }, actorId, "invoice.create");
  });
}

/** Next occurrence of a RECURRING template: same client/items/terms, tax re-resolved, AWAITING_APPROVAL. */
export async function cloneRecurringOccurrence(template: InvoiceFull, occurrenceAt: Date, actorId: string | null): Promise<InvoiceFull> {
  const { tax } = await loadClientTax(template.clientId);
  return prisma.$transaction((tx) =>
    insertDocument(
      tx,
      {
        clientId: template.clientId,
        docType: tax.docType,
        taxMode: tax.taxMode,
        placeOfSupply: tax.placeOfSupply,
        plan: "RECURRING",
        scheduleId: template.scheduleId,
        gstPercent: template.gstPercent.toNumber(),
        items: rowsFromModel(template.items),
        description: template.description,
        notes: template.notes,
        paymentTerms: template.paymentTerms,
        dueDate: shiftedDueDate(template.approvedAt ?? template.sentAt ?? template.createdAt, template.dueDate, occurrenceAt),
        tdsApplicable: template.tdsApplicable,
      },
      actorId,
      "invoice.recur_generate",
      { template: template.number },
    ),
  );
}
