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

/**
 * Google Meet REST API v2 scopes (ADR 0015). Domain-wide delegation must ALSO grant these. They are requested with a
 * separate token (`getMeetJwt`) so a delegation that doesn't include them yet only breaks the Meet extras (open access,
 * Gemini notes, filing notes, locking on delete), never Drive / Calendar / Chat.
 * - meetings.space.created: spaces the app creates + endActiveConference
 * - meetings.space.settings: patch the config of the organiser's spaces (Calendar-created Meet links)
 * - meetings.space.readonly: conference records, smart notes and transcripts of the organiser's meetings
 */
export const MEET_SCOPES = [
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/meetings.space.settings",
  "https://www.googleapis.com/auth/meetings.space.readonly",
];

/** Everything the service account's domain-wide delegation must list (Admin console → Security → API controls). */
export const DWD_SCOPES = [...SA_SCOPES, ...MEET_SCOPES];

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

let meetJwt: JWT | null = null;

/** Meet API token for the impersonated organiser (the company user whose calendar owns the task events). */
export function getMeetJwt(): JWT {
  if (meetJwt) return meetJwt;
  if (!env.serviceAccountKeyB64) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 not configured");
  const key = JSON.parse(Buffer.from(env.serviceAccountKeyB64, "base64").toString("utf8")) as { client_email: string; private_key: string };
  meetJwt = new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: MEET_SCOPES, subject: env.impersonateUser || undefined });
  return meetJwt;
}

/** JWT impersonating a specific Workspace user (domain-wide delegation) — used for per-user Calendar reads. */
export function getJwtFor(email: string, scopes: string[] = SA_SCOPES): JWT {
  if (!env.serviceAccountKeyB64) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 not configured");
  const key = JSON.parse(Buffer.from(env.serviceAccountKeyB64, "base64").toString("utf8")) as { client_email: string; private_key: string };
  return new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes, subject: email });
}

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const mailJwts = new Map<string, JWT>();

/** gmail.send-only token for a specific mailbox (the finance sender, ADR 0018); cached per mailbox. */
function getMailJwt(email: string): JWT {
  const key = email.toLowerCase();
  let j = mailJwts.get(key);
  if (!j) {
    j = getJwtFor(key, [GMAIL_SEND_SCOPE]);
    mailJwts.set(key, j);
  }
  return j;
}

/**
 * Domain-wide delegation refused to act as this user: the account is outside the service account's Workspace (e.g. an
 * admin on a separate Google Workspace, ADR 0018), suspended/unknown, or the scope isn't delegated. Retrying never helps.
 */
export function isDelegationError(e: unknown): boolean {
  const err = e as { message?: string; response?: { data?: { error?: unknown; error_description?: unknown } } } | null;
  if (!err || typeof err !== "object") return false;
  const data = err.response?.data;
  const oauth = typeof data?.error === "string" ? data.error : "";
  if (oauth === "unauthorized_client" || oauth === "invalid_grant" || oauth === "access_denied") return true;
  const text = `${err.message ?? ""} ${typeof data?.error_description === "string" ? data.error_description : ""}`;
  return /unauthorized_client|invalid_grant|Client is unauthorized|Invalid email or User ID|not authorized for any of the scopes/i.test(text);
}

const undelegable = new Set<string>();

/**
 * Runs a per-user call (JWT subject = `email`). If delegation can't impersonate that user, logs once, remembers it for
 * this process and returns `fallback` — callers degrade (skip the user) instead of failing a job or a save.
 */
export async function asWorkspaceUser<T>(email: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  const key = email.toLowerCase();
  if (undelegable.has(key)) return fallback;
  try {
    return await fn();
  } catch (e) {
    if (!isDelegationError(e)) throw e;
    undelegable.add(key);
    console.warn(`[google] cannot impersonate ${key} (outside the delegated Workspace?); skipping per-user calls: ${e instanceof Error ? e.message : String(e)}`);
    return fallback;
  }
}

/** Test hook: forget which users failed delegation. */
export function resetUndelegable() {
  undelegable.clear();
}

export const drive = () => google.drive({ version: "v3", auth: getJwt() });
export const calendarAs = (email: string) => google.calendar({ version: "v3", auth: getJwtFor(email) });
export const calendar = () => google.calendar({ version: "v3", auth: getJwt() });
export const chat = () => google.chat({ version: "v1", auth: getJwt() });
export const gmail = () => google.gmail({ version: "v1", auth: getJwt() });
/** Gmail as a specific mailbox (the finance sender); the default mailbox reuses the shared token. */
export const gmailAs = (email: string) =>
  email.trim().toLowerCase() === env.impersonateUser.trim().toLowerCase() ? gmail() : google.gmail({ version: "v1", auth: getMailJwt(email) });
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
