import { prisma } from "@/lib/db";
import { cloneRecurringOccurrence, generateBalanceInvoiceCore, sendInvoiceCore } from "@/server/finance/invoice-core";
import { draftAutoBalanceInvoices } from "@/server/finance/balance-auto";
import { isRuleActive, nextOccurrenceAfter } from "@/server/finance/recurrence";

export type InvoiceJobResult = { sent: number; generated: number; drafted: number; overdue: number };

/**
 * Invoice scheduler (SPEC §11.3). Idempotent — every step changes the state it selects on:
 *  (a) SCHEDULED invoices whose sendAt has passed are sent (→ SENT);
 *  (b) active recurrence rules whose nextRunAt has passed generate + send one new occurrence, then nextRunAt advances past now;
 *  (c) SENT / PARTIALLY_PAID invoices past their due date become OVERDUE;
 *  (d) ADVANCE invoices in DATE mode whose balanceDueOn has passed get their balance invoice generated + sent;
 *  (e) ADVANCE invoices in AUTO mode get a DRAFT balance invoice once the client's tasks are complete — Admin is
 *      notified and sends it by hand.
 */
export async function run(now = new Date()): Promise<InvoiceJobResult> {
  let sent = 0;
  let generated = 0;

  const due = await prisma.invoice.findMany({ where: { status: "SCHEDULED", sendAt: { lte: now } }, select: { id: true } });
  for (const inv of due) {
    try {
      await sendInvoiceCore(inv.id, null);
      sent++;
    } catch (e) {
      console.error("[jobs/invoices] send failed", inv.id, e);
    }
  }

  const rules = await prisma.recurrenceRule.findMany({
    where: { nextRunAt: { lte: now }, stopped: false, invoices: { some: {} } },
    include: { invoices: { orderBy: { createdAt: "asc" }, take: 1, include: { items: true, client: true, schedule: true } } },
  });
  for (const rule of rules) {
    const template = rule.invoices[0];
    if (!template || !rule.nextRunAt) continue;
    if (!isRuleActive(rule, now)) {
      await prisma.recurrenceRule.update({ where: { id: rule.id }, data: { stopped: true } });
      continue;
    }
    try {
      const next = nextOccurrenceAfter(rule.nextRunAt, rule, now);
      // Advance the pointer first so a failure while sending never produces duplicate occurrences.
      await prisma.recurrenceRule.update({ where: { id: rule.id }, data: { nextRunAt: next } });
      const clone = await cloneRecurringOccurrence(template, rule.nextRunAt, null);
      await sendInvoiceCore(clone.id, null);
      generated++;
      sent++;
    } catch (e) {
      console.error("[jobs/invoices] recurrence failed", rule.id, e);
    }
  }

  const overdue = await prisma.invoice.updateMany({
    where: { status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: now } },
    data: { status: "OVERDUE" },
  });

  const advances = await prisma.invoice.findMany({
    where: { paymentMode: "ADVANCE", balanceMode: "DATE", balanceDueOn: { lte: now }, balanceInvoice: null, status: { notIn: ["DRAFT", "SCHEDULED"] } },
    select: { id: true },
  });
  for (const adv of advances) {
    try {
      await generateBalanceInvoiceCore(adv.id, null, true);
      generated++;
      sent++;
    } catch (e) {
      console.error("[jobs/invoices] balance invoice failed", adv.id, e);
    }
  }

  const drafted = await draftAutoBalanceInvoices();

  return { sent, generated, drafted, overdue: overdue.count };
}
