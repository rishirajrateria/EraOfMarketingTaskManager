import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendMail } from "@/google/gmail";
import { sendWhatsapp } from "@/integrations/whatsapp";
import { loadCompany, loadInvoiceFull, toPdfInvoice } from "@/server/finance/document-core";
import { renderInvoicePdf } from "@/server/finance/pdf";
import { renderTemplate } from "@/server/finance/drive-store";
import { templateVars } from "@/server/finance/approve-core";
import { loadSettlement } from "@/server/finance/settlement";

/** Manual payment reminder (SPEC §11.3, ADR 0005): re-sends the PDF by email and, when the client has a number, WhatsApp. */
export const REMINDABLE_STATUSES = ["SENT", "PARTIALLY_PAID", "OVERDUE"] as const;
type Remindable = (typeof REMINDABLE_STATUSES)[number];

export const REMINDER_TEMPLATE =
  "Dear {{client}},\n\nGentle reminder: invoice {{number}} for INR {{total}} was due on {{dueDate}}; outstanding INR {{balance}}.\n\n" +
  "The invoice is attached again for your convenience. Please ignore this note if payment is already on its way.\n\nRegards,\n{{company}}";

export type ReminderResult = { reminderSentAt: Date; reminderCount: number; balance: number; emailed: boolean; whatsapped: boolean };

export async function sendReminderCore(id: string, actorId: string | null): Promise<ReminderResult> {
  const inv = await loadInvoiceFull(id);
  if (!inv) throw new Error("Invoice not found");
  if (!REMINDABLE_STATUSES.includes(inv.status as Remindable)) throw new Error("Reminders can only be sent for sent, partially paid or overdue invoices");
  if (!inv.client.email && !inv.client.whatsapp) throw new Error("Client has neither an email nor a WhatsApp number on file");

  const company = await loadCompany();
  const vars = await templateVars(inv, company);
  const { balance } = await loadSettlement(inv.id);
  const errors: string[] = [];
  let emailed = false;
  let whatsapped = false;
  if (inv.client.email) {
    const pdf = inv.pdfData && inv.pdfData.length > 0 ? Buffer.from(inv.pdfData) : await renderInvoicePdf(toPdfInvoice(inv), inv.client, company);
    try {
      await sendMail({
        to: inv.client.email,
        subject: `Reminder: invoice ${inv.number} from ${company.companyName}`,
        text: renderTemplate(REMINDER_TEMPLATE, vars),
        attachments: [{ filename: `${inv.number}.pdf`, mimeType: "application/pdf", data: pdf }],
      });
      emailed = true;
    } catch (e) {
      errors.push(`Email failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (inv.client.whatsapp) {
    const r = await sendWhatsapp({ to: inv.client.whatsapp, body: renderTemplate(company.reminderWhatsappTemplate, vars), mediaUrl: vars.link || null });
    if (r.ok) whatsapped = true;
    else errors.push(`WhatsApp failed: ${r.error}`);
  }
  if (!emailed && !whatsapped) throw new Error(errors.join("; ") || "Reminder could not be sent");

  const reminderSentAt = new Date();
  const updated = await prisma.invoice.update({ where: { id }, data: { reminderSentAt, reminderCount: { increment: 1 } }, select: { reminderCount: true } });
  await audit(
    actorId,
    "invoice.reminder",
    "Invoice",
    id,
    { reminderCount: inv.reminderCount, reminderSentAt: inv.reminderSentAt },
    { reminderCount: updated.reminderCount, reminderSentAt, balance, emailed, whatsapped, errors },
  );
  return { reminderSentAt, reminderCount: updated.reminderCount, balance, emailed, whatsapped };
}
