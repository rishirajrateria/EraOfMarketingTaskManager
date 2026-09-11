import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fmtDate } from "@/lib/time";
import { sendMail } from "@/google/gmail";
import { loadCompany, toPdfInvoice } from "@/server/finance/invoice-core";
import { formatINRNumber, round2 } from "@/server/finance/money";
import { renderInvoicePdf } from "@/server/finance/pdf";
import { renderTemplate } from "@/server/finance/drive-store";

/** Manual payment reminder (SPEC §11.3): re-emails the invoice PDF with a gentle nudge; tracked on the invoice. */
export const REMINDABLE_STATUSES = ["SENT", "PARTIALLY_PAID", "OVERDUE"] as const;
type Remindable = (typeof REMINDABLE_STATUSES)[number];

export const REMINDER_TEMPLATE =
  "Dear {{client}},\n\nGentle reminder: invoice {{number}} for INR {{total}} was due on {{dueDate}}; outstanding INR {{balance}}.\n\n" +
  "The invoice is attached again for your convenience. Please ignore this note if payment is already on its way.\n\nRegards,\n{{company}}";

export type ReminderResult = { reminderSentAt: Date; reminderCount: number; balance: number };

export async function sendReminderCore(id: string, actorId: string | null): Promise<ReminderResult> {
  const inv = await prisma.invoice.findUnique({ where: { id }, include: { items: true, client: true, schedule: true, payments: { select: { amount: true } } } });
  if (!inv) throw new Error("Invoice not found");
  if (!REMINDABLE_STATUSES.includes(inv.status as Remindable)) throw new Error("Reminders can only be sent for sent, partially paid or overdue invoices");
  if (!inv.client.email) throw new Error("Client has no email on file");

  const company = await loadCompany();
  const pdf = inv.pdfData && inv.pdfData.length > 0 ? Buffer.from(inv.pdfData) : await renderInvoicePdf(toPdfInvoice(inv), inv.client, company);
  const received = inv.payments.reduce((s, p) => s + p.amount.toNumber(), 0);
  const balance = round2(Math.max(0, inv.total.toNumber() - received));
  const vars = {
    client: inv.client.name,
    number: inv.number,
    total: formatINRNumber(inv.total.toNumber()),
    balance: formatINRNumber(balance),
    dueDate: inv.dueDate ? fmtDate(inv.dueDate, company.timezone, "d MMM yyyy") : "receipt",
    company: company.companyName,
  };
  await sendMail({
    to: inv.client.email,
    subject: `Reminder: invoice ${inv.number} from ${company.companyName}`,
    text: renderTemplate(REMINDER_TEMPLATE, vars),
    attachments: [{ filename: `${inv.number}.pdf`, mimeType: "application/pdf", data: pdf }],
  });

  const reminderSentAt = new Date();
  const updated = await prisma.invoice.update({
    where: { id },
    data: { reminderSentAt, reminderCount: { increment: 1 } },
    select: { reminderCount: true },
  });
  await audit(
    actorId,
    "invoice.reminder",
    "Invoice",
    id,
    { reminderCount: inv.reminderCount, reminderSentAt: inv.reminderSentAt },
    { reminderCount: updated.reminderCount, reminderSentAt, balance, to: inv.client.email },
  );
  return { reminderSentAt, reminderCount: updated.reminderCount, balance };
}
