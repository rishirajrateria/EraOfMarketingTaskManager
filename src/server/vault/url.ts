/** Vault links are http(s) only (ADR 0020): `javascript:`, `data:`, `file:` and friends are refused on the server. Pure; safe on client and server. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** The URL when it is http(s), else null — used when rendering links so legacy bad rows can never become a script link. */
export const safeHttpUrl = (value: string | null | undefined): string | null => (value && isHttpUrl(value) ? value : null);
