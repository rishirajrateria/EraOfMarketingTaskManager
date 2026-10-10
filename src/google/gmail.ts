import { gmail, isMock, withRetry } from "@/google/client";
import { env } from "@/lib/env";

export type MailAttachment = { filename: string; mimeType: string; data: Buffer };

/** RFC 2047 encoded-word for non-ASCII attachment names (e.g. "Invoice No. … (शर्मा ट्रेडर्स).pdf"); quotes stripped. */
export function mimeFileName(name: string): string {
  const clean = name.replace(/["\\\r\n]/g, "");
  return /^[\x20-\x7e]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean).toString("base64")}?=`;
}

function encodeMime(opts: { to: string; from: string; subject: string; text: string; attachments?: MailAttachment[] }) {
  const boundary = "eom_" + Math.random().toString(36).slice(2);
  const lines = [
    `From: ${opts.from}`,
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

export const sentMailLog: { to: string; subject: string; at: Date }[] = [];
/** Mock mode: body + attachment names/sizes of every mail (tests that need more than to/subject). */
export const sentMailDetails: { to: string; subject: string; text: string; attachments: { filename: string; mimeType: string; size: number }[] }[] = [];

export async function sendMail(opts: { to: string; subject: string; text: string; attachments?: MailAttachment[] }) {
  if (isMock()) {
    sentMailLog.push({ to: opts.to, subject: opts.subject, at: new Date() });
    sentMailDetails.push({ to: opts.to, subject: opts.subject, text: opts.text, attachments: (opts.attachments ?? []).map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.data.length })) });
    return { id: `mock_mail_${sentMailLog.length}` };
  }
  const raw = encodeMime({ ...opts, from: env.impersonateUser });
  const res = await withRetry(() => gmail().users.messages.send({ userId: "me", requestBody: { raw } }));
  return { id: res.data.id ?? "" };
}
