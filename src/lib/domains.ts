/**
 * Allowed sign-in / invite domains (ADR 0018). Pure helpers — safe to import from client components.
 * The first domain is the staff domain (used for placeholders); the rest are extra domains such as the admin's.
 */

/** "a.com, @B.com ,a.com" → ["a.com", "b.com"] (lower-case, no "@", de-duplicated, order kept). */
export function parseDomains(...raws: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const raw of raws) {
    for (const part of (raw ?? "").split(/[\s,;]+/)) {
      const d = part.trim().toLowerCase().replace(/^@+/, "");
      if (d && !out.includes(d)) out.push(d);
    }
  }
  return out;
}

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/** True when no domain is configured, or the email ends with one of them. */
export function emailInDomains(email: string, domains: readonly string[]): boolean {
  if (!domains.length) return true;
  return domains.includes(emailDomain(email));
}

/** "@a.com", "@a.com or @b.com", "@a.com, @b.com or @c.com". */
export function domainList(domains: readonly string[]): string {
  const at = domains.map((d) => `@${d}`);
  return at.length <= 1 ? (at[0] ?? "") : `${at.slice(0, -1).join(", ")} or ${at[at.length - 1]}`;
}

/** People form hint: "Must end with @a.com or @b.com" (undefined when any domain is allowed). */
export function domainHint(domains: readonly string[]): string | undefined {
  return domains.length ? `Must end with ${domainList(domains)}` : undefined;
}

/** Sign-in rule (SPEC §4): any configured domain, plus explicitly listed bootstrap admins. */
export function signInEmailAllowed(email: string, opts: { domains: readonly string[]; bootstrapAdmins: readonly string[] }): boolean {
  const lower = email.trim().toLowerCase();
  if (!lower) return false;
  if (opts.bootstrapAdmins.includes(lower)) return true;
  return emailInDomains(lower, opts.domains);
}

/** Google's `hd` hint only narrows the account chooser to ONE domain, so it is sent only when exactly one is configured. */
export function hostedDomainParam(domains: readonly string[]): { hd: string } | Record<string, never> {
  return domains.length === 1 ? { hd: domains[0] } : {};
}
