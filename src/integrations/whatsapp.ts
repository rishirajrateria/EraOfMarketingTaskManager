/**
 * WhatsApp via Twilio REST (ADR 0005). Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM.
 * Mock mode (no credentials or GOOGLE_MOCK=true) records messages in `sentWhatsappLog` for tests.
 * Never throws: HTTP 4xx/5xx and network errors come back as `{ ok: false, error }`.
 */
export type WhatsappMessage = { to: string; body: string; mediaUrl?: string | null };
export type WhatsappResult = { ok: true; sid: string } | { ok: false; error: string };

export const sentWhatsappLog: { to: string; body: string; mediaUrl: string | null; at: Date }[] = [];

function creds() {
  const sid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN ?? "";
  const from = process.env.TWILIO_WHATSAPP_FROM ?? "";
  return { sid, token, from };
}

export function isWhatsappMock(): boolean {
  const { sid, token } = creds();
  const googleMock = (process.env.GOOGLE_MOCK ?? "true") !== "false";
  return googleMock || !sid || !token;
}

/** "+91 98765 43210" → "+919876543210"; a bare 10-digit Indian mobile gets +91; null when it cannot be E.164. */
export function normalizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  const bare = digits.replace(/^\+/, "").replace(/^0+/, "");
  const withCountry = digits.startsWith("+") ? digits : /^[6-9]\d{9}$/.test(bare) ? `+91${bare}` : `+${bare}`;
  return /^\+[1-9]\d{6,14}$/.test(withCountry) ? withCountry : null;
}

const asWhatsappAddress = (n: string) => (n.startsWith("whatsapp:") ? n : `whatsapp:${n}`);

export async function sendWhatsapp(msg: WhatsappMessage): Promise<WhatsappResult> {
  const to = normalizeE164(msg.to);
  if (!to) return { ok: false, error: "Invalid WhatsApp number (expected E.164, e.g. +919876543210)" };
  if (isWhatsappMock()) {
    sentWhatsappLog.push({ to, body: msg.body, mediaUrl: msg.mediaUrl ?? null, at: new Date() });
    return { ok: true, sid: `mock_wa_${sentWhatsappLog.length}` };
  }
  const { sid, token, from } = creds();
  if (!from) return { ok: false, error: "TWILIO_WHATSAPP_FROM is not configured" };
  const form = new URLSearchParams();
  form.set("From", asWhatsappAddress(from));
  form.set("To", asWhatsappAddress(to));
  form.set("Body", msg.body);
  if (msg.mediaUrl) form.set("MediaUrl", msg.mediaUrl);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (!res.ok) return { ok: false, error: `Twilio ${res.status}${data.code ? ` (${data.code})` : ""}: ${data.message ?? res.statusText}` };
    return { ok: true, sid: data.sid ?? "" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
