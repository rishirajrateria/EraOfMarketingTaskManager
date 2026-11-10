/**
 * Pure grant-evaluation logic for the client vault (SPEC §11.1). No DB, no Next — unit-tested directly
 * and safe to import from client components for countdowns.
 */
export type GrantLike = {
  revoked: boolean;
  expiresAt: Date | string | null;
  expiresAfterFirstOpenMinutes: number | null;
  firstOpenedAt: Date | string | null;
};

const toDate = (d: Date | string | null): Date | null => (d == null ? null : d instanceof Date ? d : new Date(d));

/**
 * Effective expiry instant of a grant, or null when it never expires (as far as we currently know).
 * When both an absolute expiry and an after-first-open window apply, the earlier one wins.
 * An after-first-open window that has not started yet (firstOpenedAt null) contributes nothing.
 */
export function grantExpiresAt(grant: GrantLike): Date | null {
  const candidates: Date[] = [];
  const abs = toDate(grant.expiresAt);
  if (abs) candidates.push(abs);
  const opened = toDate(grant.firstOpenedAt);
  if (grant.expiresAfterFirstOpenMinutes != null && opened) {
    candidates.push(new Date(opened.getTime() + grant.expiresAfterFirstOpenMinutes * 60_000));
  }
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
}

/**
 * A grant is active if it is not revoked AND (expiresAt is null or in the future) AND
 * (no after-first-open window, or it has not been opened yet, or the window has not elapsed).
 */
export function grantIsActive(grant: GrantLike, now: Date = new Date()): boolean {
  if (grant.revoked) return false;
  const abs = toDate(grant.expiresAt);
  if (abs && abs.getTime() <= now.getTime()) return false;
  const opened = toDate(grant.firstOpenedAt);
  if (grant.expiresAfterFirstOpenMinutes != null && opened) {
    if (opened.getTime() + grant.expiresAfterFirstOpenMinutes * 60_000 <= now.getTime()) return false;
  }
  return true;
}

/** Milliseconds until the grant expires; null when no expiry is currently known; 0 when already expired. */
export function grantMillisLeft(grant: GrantLike, now: Date = new Date()): number | null {
  const exp = grantExpiresAt(grant);
  if (!exp) return null;
  return Math.max(0, exp.getTime() - now.getTime());
}

/** Human line for the expiry state: "Expires in 12m", "Expires 30 min after first open", "No expiry", "Expired". */
export function describeExpiry(grant: GrantLike, now: Date = new Date()): string {
  if (grant.revoked) return "Revoked";
  if (!grantIsActive(grant, now)) return "Expired";
  const left = grantMillisLeft(grant, now);
  const parts: string[] = [];
  if (left != null) parts.push(`Expires in ${fmtDuration(left)}`);
  if (grant.expiresAfterFirstOpenMinutes != null && !grant.firstOpenedAt) {
    parts.push(`${fmtDuration(grant.expiresAfterFirstOpenMinutes * 60_000)} after first open`);
  }
  return parts.length ? parts.join(" · ") : "No expiry";
}

export function fmtDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(totalSec / 86_400);
  const h = Math.floor((totalSec % 86_400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}
