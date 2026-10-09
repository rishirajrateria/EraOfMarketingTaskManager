import { prisma } from "@/lib/db";
import { adminIds, notify } from "@/lib/notify";
import { getSettings } from "@/lib/settings";
import { formatINRPlain } from "@/server/finance/money";
import { cloneRecurringOccurrence } from "@/server/finance/invoice-core";
import { FULL_INCLUDE } from "@/server/finance/document-core";
import { issuePartCore } from "@/server/finance/parts-core";
import { isRuleActive, nextOccurrenceAfter } from "@/server/finance/recurrence";

export type InvoiceJobResult = { issued: number; cloned: number; reminded: number; overdue: number };

/**
 * Invoice scheduler (ADR 0005). Nothing is ever emailed or WhatsApped by a job — every document it creates waits
 * for Admin in the approval queue. Idempotent: every step changes the state it selects on.
 *  (a) PENDING parts whose due date has arrived are issued as AWAITING_APPROVAL and admins are notified;
 *  (b) active recurrence rules whose nextRunAt has passed clone one new occurrence (AWAITING_APPROVAL) and advance;
 *  (c) `remindAt` reminders ("push forward") notify admins and are cleared;
 *  (d) SENT / PARTIALLY_PAID invoices past their due date become OVERDUE.
 */
async function tellAdmins(title: string, body: string, invoiceId: string) {
  await notify({ userIds: await adminIds(), kind: "INVOICE_APPROVAL_DUE", title, body, href: `/admin/invoices/${invoiceId}` });
}

async function issueDueParts(now: Date): Promise<number> {
  const parts = await prisma.invoicePart.findMany({
    where: { status: "PENDING", dueDate: { lte: now }, plan: { status: "ACTIVE" } },
    include: { plan: { select: { title: true, client: { select: { name: true } } } } },
    orderBy: [{ planId: "asc" }, { seq: "asc" }],
  });
  let issued = 0;
  for (const part of parts) {
    try {
      const inv = await issuePartCore(part.planId, part.seq, null);
      await tellAdmins(`Part ${part.seq} of ${part.plan.title} is due — approve and send`, `${part.plan.client.name} · ${formatINRPlain(inv.total.toNumber())}`, inv.id);
      issued++;
    } catch (e) {
      console.error("[jobs/invoices] part issue failed", part.id, e);
    }
  }
  return issued;
}

async function cloneDueRecurrences(now: Date): Promise<number> {
  const tz = (await getSettings()).timezone;
  const rules = await prisma.recurrenceRule.findMany({
    where: { nextRunAt: { lte: now }, stopped: false, invoices: { some: {} } },
    include: { invoices: { orderBy: { createdAt: "asc" }, take: 1, include: FULL_INCLUDE } },
  });
  let cloned = 0;
  for (const rule of rules) {
    const template = rule.invoices[0];
    if (!template || !rule.nextRunAt) continue;
    if (!isRuleActive(rule, now)) {
      await prisma.recurrenceRule.update({ where: { id: rule.id }, data: { stopped: true } });
      continue;
    }
    try {
      const next = nextOccurrenceAfter(rule.nextRunAt, rule, now, tz);
      // Advance the pointer first so a failure while cloning never produces duplicate occurrences.
      await prisma.recurrenceRule.update({ where: { id: rule.id }, data: { nextRunAt: next } });
      const clone = await cloneRecurringOccurrence(template, rule.nextRunAt, null);
      await tellAdmins(`Invoice for ${template.client.name} is ready — approve to send`, `${formatINRPlain(clone.total.toNumber())} · recurring · next on ${next.toISOString().slice(0, 10)}`, clone.id);
      cloned++;
    } catch (e) {
      console.error("[jobs/invoices] recurrence failed", rule.id, e);
    }
  }
  return cloned;
}

async function fireReminders(now: Date): Promise<number> {
  const due = await prisma.invoice.findMany({
    where: { remindAt: { lte: now }, status: { notIn: ["PAID", "CANCELLED"] } },
    select: { id: true, number: true, total: true, status: true, client: { select: { name: true } } },
  });
  let reminded = 0;
  for (const inv of due) {
    try {
      await prisma.invoice.update({ where: { id: inv.id }, data: { remindAt: null } });
      await tellAdmins(`Reminder: approve and send invoice for ${inv.client.name}`, `${inv.number.startsWith("DRAFT-") ? "Draft" : inv.number} · ${formatINRPlain(inv.total.toNumber())} · ${inv.status.toLowerCase().replace("_", " ")}`, inv.id);
      reminded++;
    } catch (e) {
      console.error("[jobs/invoices] reminder failed", inv.id, e);
    }
  }
  return reminded;
}

export async function run(now = new Date()): Promise<InvoiceJobResult> {
  const issued = await issueDueParts(now);
  const cloned = await cloneDueRecurrences(now);
  const reminded = await fireReminders(now);
  const overdue = await prisma.invoice.updateMany({
    where: { status: { in: ["SENT", "PARTIALLY_PAID"] }, docType: { in: ["TAX_INVOICE", "EXPORT_INVOICE"] }, dueDate: { lt: now } },
    data: { status: "OVERDUE" },
  });
  return { issued, cloned, reminded, overdue: overdue.count };
}
