import { google } from "googleapis";
import type { JWT } from "google-auth-library";
import { env } from "@/lib/env";

/**
 * Service account with domain-wide delegation (SPEC §1). All server-side Google calls impersonate
 * GOOGLE_IMPERSONATE_USER so resources are owned by the company, not the creating user.
 * When GOOGLE_MOCK=true (default in dev/CI) every wrapper returns deterministic fake ids.
 */
export const SA_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.memberships",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/spreadsheets",
];

export const isMock = () => env.googleMock;

let jwt: JWT | null = null;

export function getJwt(): JWT {
  if (jwt) return jwt;
  if (!env.serviceAccountKeyB64) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 not configured");
  const key = JSON.parse(Buffer.from(env.serviceAccountKeyB64, "base64").toString("utf8")) as {
    client_email: string;
    private_key: string;
  };
  jwt = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: SA_SCOPES,
    subject: env.impersonateUser || undefined,
  });
  return jwt;
}

export const drive = () => google.drive({ version: "v3", auth: getJwt() });
export const calendar = () => google.calendar({ version: "v3", auth: getJwt() });
export const chat = () => google.chat({ version: "v1", auth: getJwt() });
export const gmail = () => google.gmail({ version: "v1", auth: getJwt() });
export const sheets = () => google.sheets({ version: "v4", auth: getJwt() });

export function mockId(prefix: string, seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${prefix}_${h.toString(36)}`;
}

/** Retry with exponential backoff for transient Google errors (SPEC §14). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 4, baseMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const code = (e as { code?: number; response?: { status?: number } }).code ?? (e as { response?: { status?: number } }).response?.status;
      const retryable = code === 429 || code === 500 || code === 502 || code === 503 || code === undefined;
      if (!retryable || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}
