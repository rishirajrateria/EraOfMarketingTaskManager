import { gmail, isMock, withRetry } from "@/google/client";
import { env } from "@/lib/env";

export type MailAttachment = { filename: string; mimeType: string; data: Buffer };

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
      `Content-Type: ${a.mimeType}; name="${a.filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${a.filename}"`,
      "",
      a.data.toString("base64"),
    );
  }
  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export const sentMailLog: { to: string; subject: string; at: Date }[] = [];

export async function sendMail(opts: { to: string; subject: string; text: string; attachments?: MailAttachment[] }) {
  if (isMock()) {
    sentMailLog.push({ to: opts.to, subject: opts.subject, at: new Date() });
    return { id: `mock_mail_${sentMailLog.length}` };
  }
  const raw = encodeMime({ ...opts, from: env.impersonateUser });
  const res = await withRetry(() => gmail().users.messages.send({ userId: "me", requestBody: { raw } }));
  return { id: res.data.id ?? "" };
}
