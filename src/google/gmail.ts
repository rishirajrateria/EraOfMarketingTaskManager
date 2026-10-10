import { gmailAs, isMock, withRetry } from "@/google/client";
import { env } from "@/lib/env";

export type MailAttachment = { filename: string; mimeType: string; data: Buffer };

/**
 * Which mailbox a mail goes out from (ADR 0018):
 * - "default": GOOGLE_IMPERSONATE_USER — task notifications, invites, client kits, meetings.
 * - "finance": GOOGLE_FINANCE_SENDER (e.g. finance@theeraofmarketing.com) — invoices, proformas, credit notes,
 *   cancellations, receipts, payment reminders, the GST pack. Falls back to the default mailbox when unset.
 */
export type MailSender = "default" | "finance";

/** The mailbox (JWT subject + From address) for a sender kind; "" when nothing is configured. */
export function senderMailbox(sender: MailSender = "default"): string {
  if (sender === "finance" && env.financeSender) return env.financeSender;
  return env.impersonateUser.trim().toLowerCase();
}

/** RFC 2047 encoded-word for non-ASCII attachment names (e.g. "Invoice No. … (शर्मा ट्रेडर्स).pdf"); quotes stripped. */
export function mimeFileName(name: string): string {
  const clean = name.replace(/["\\\r\n]/g, "");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean).toString("base64")}?=`;
}

/** `"Era Of Marketing Finance" <finance@…>` (display name quoted or RFC 2047-encoded; CR/LF stripped). */
export function formatAddress(address: string, name?: string | null): string {
  const addr = address.replace(/[\r\n<>"]/g, "").trim();
  const clean = (name ?? "").replace(/["\\\r\n]/g, "").trim();
  if (!clean) return addr;
  const display = /^[\x20-\x7e]*$/.test(clean) ? `"${clean}"` : `=?UTF-8?B?${Buffer.from(clean).toString("base64")}?=`;
  return `${display} <${addr}>`;
}

/** "<Company> Finance" from settings; null if settings can't be read (the bare address is used then). */
async function financeDisplayName(): Promise<string | null> {
  try {
    const { getSettings } = await import("@/lib/settings");
    const company = (await getSettings()).companyName?.trim();
    return company ? `${company} Finance` : "Finance";
  } catch {
    return null;
  }
}

/** From / Reply-To headers for a sender kind. Finance mail carries a display name and replies go back to finance. */
export async function senderHeaders(sender: MailSender): Promise<{ mailbox: string; from: string; replyTo: string | null }> {
  const mailbox = senderMailbox(sender);
  if (sender !== "finance" || !mailbox) return { mailbox, from: mailbox, replyTo: null };
  const from = formatAddress(mailbox, await financeDisplayName());
  return { mailbox, from, replyTo: from };
}

function encodeMime(opts: { to: string; from: string; replyTo?: string | null; subject: string; text: string; attachments?: MailAttachment[] }) {
  const boundary = "eom_" + Math.random().toString(36).slice(2);
  const lines = [
    ...(opts.from ? [`From: ${opts.from}`] : []),
    ...(opts.replyTo ? [`Reply-To: ${opts.replyTo}`] : []),
    `To: ${opts.to}`,
    `Subject: =?UTF-8?B?${Buffer.from(opts.subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.text,
  ];
  for (const a of opts.attachments ?? []) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.mimeType}; name="${mimeFileName(a.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${mimeFileName(a.filename)}"`,
      "",
      a.data.toString("base64"),
    );
  }
  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

/** Mock mode: every mail with the sender kind and the mailbox it went out from (`from`, "" when none is configured). */
export const sentMailLog: { to: string; subject: string; sender: MailSender; from: string; at: Date }[] = [];
/** Mock mode: body + attachment names/sizes + headers of every mail (tests that need more than to/subject). */
export const sentMailDetails: {
  to: string;
  subject: string;
  text: string;
  sender: MailSender;
  from: string;
  fromHeader: string;
  replyTo: string | null;
  attachments: { filename: string; mimeType: string; size: number }[];
}[] = [];

export type SendMailOptions = { to: string; subject: string; text: string; attachments?: MailAttachment[]; sender?: MailSender };

export async function sendMail(opts: SendMailOptions) {
  const sender = opts.sender ?? "default";
  const h = await senderHeaders(sender);
  if (isMock()) {
    sentMailLog.push({ to: opts.to, subject: opts.subject, sender, from: h.mailbox, at: new Date() });
    sentMailDetails.push({
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      sender,
      from: h.mailbox,
      fromHeader: h.from,
      replyTo: h.replyTo,
      attachments: (opts.attachments ?? []).map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.data.length })),
    });
    return { id: `mock_mail_${sentMailLog.length}` };
  }
  const raw = encodeMime({ ...opts, from: h.from, replyTo: h.replyTo });
  // The finance mailbox is impersonated directly (JWT subject = finance sender, gmail.send only), so the mail sits in
  // its Sent folder and the From address is genuine; the default mailbox reuses the shared token.
  const res = await withRetry(() => gmailAs(h.mailbox).users.messages.send({ userId: "me", requestBody: { raw } }));
  return { id: res.data.id ?? "" };
}
