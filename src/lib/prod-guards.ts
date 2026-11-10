/**
 * Production launch guards (ADR 0020). Pure functions over an env-like object so they are unit-testable and run
 * identically at server boot (src/instrumentation.ts) and in `src/lib/crypto.ts`. Nothing here touches I/O.
 *
 * In NODE_ENV=production the server refuses to start with mock Google, demo sign-in, missing or publicly-known
 * secrets, or a vault key that is not 32 bytes of base64. ALLOW_DEMO_IN_PRODUCTION=true is the explicit (UNSAFE)
 * escape hatch for staging / demo deployments: it permits mock Google and demo sign-in and relaxes the vault-key
 * format check (the key is then hashed as in development). It never permits missing or default secrets.
 */
export type EnvLike = Record<string, string | undefined>;

/** Secrets that ship in docker-compose.yml, .env.example or the README: public, so never acceptable in production. */
export const PUBLIC_DEFAULT_SECRETS: readonly string[] = [
  "local-dev-secret-change-me-0123456789abcdef",
  "bG9jYWwtZGV2LXZhdWx0LWtleS1jaGFuZ2UtbWUtMDEyMzQ1Njc4OQ==",
  "local-dev-cron",
  "replace-with-openssl-rand-base64-32",
  "replace-me",
  "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXktdGVzdC0xMjM=",
];

export const isProduction = (e: EnvLike) => e.NODE_ENV === "production";
export const demoEscapeHatch = (e: EnvLike) => (e.ALLOW_DEMO_IN_PRODUCTION ?? "").trim().toLowerCase() === "true";

/** True when `value` is canonical base64 that decodes to exactly 32 bytes (what AES-256 needs). */
export function isValidVaultKey(value: string | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return false;
  const raw = Buffer.from(v, "base64");
  return raw.length === 32 && raw.toString("base64") === v;
}

/** Demo sign-in is on only when DEMO_LOGIN=true, and never in production without the escape hatch. */
export function demoLoginAllowed(e: EnvLike): boolean {
  if (e.DEMO_LOGIN !== "true") return false;
  return !isProduction(e) || demoEscapeHatch(e);
}

/** Vault key rule: in production the key must be real 32-byte base64 (no silent hashing) unless the hatch is set. */
export function strictVaultKey(e: EnvLike): boolean {
  return isProduction(e) && !demoEscapeHatch(e);
}

const secretProblem = (name: string, value: string | undefined): string | null => {
  const v = (value ?? "").trim();
  if (!v) return `${name} is not set`;
  if (PUBLIC_DEFAULT_SECRETS.includes(v)) return `${name} is set to a publicly known default value`;
  return null;
};

/** Everything wrong with this environment for a production start. Empty outside production. */
export function productionProblems(e: EnvLike): string[] {
  if (!isProduction(e)) return [];
  const hatch = demoEscapeHatch(e);
  const out: string[] = [];
  if (!hatch) {
    if (e.GOOGLE_MOCK !== "false") out.push('GOOGLE_MOCK must be exactly "false" in production (it is unset or enabled, which would fake every Google call)');
    if (e.DEMO_LOGIN === "true") out.push('DEMO_LOGIN must not be "true" in production (anyone could sign in as Admin)');
  }
  for (const name of ["AUTH_SECRET", "VAULT_ENCRYPTION_KEY", "CRON_SECRET"]) {
    const p = secretProblem(name, e[name]);
    if (p) out.push(p);
  }
  if ((e.VAULT_ENCRYPTION_KEY ?? "").trim() && !hatch && !isValidVaultKey(e.VAULT_ENCRYPTION_KEY)) {
    out.push("VAULT_ENCRYPTION_KEY must be base64 of exactly 32 bytes (generate one with: openssl rand -base64 32)");
  }
  return out;
}

export class ProductionConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Refusing to start in production:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
        "Fix the environment variables above. For a staging / demo deployment ONLY, ALLOW_DEMO_IN_PRODUCTION=true relaxes the mock-Google, demo-login and vault-key-format checks (UNSAFE).",
    );
    this.name = "ProductionConfigError";
  }
}

/** The demo seed creates fake users, tasks and an admin: refuse it in production unless the unsafe hatch is set. */
export function assertSeedAllowed(e: EnvLike = process.env): void {
  if (isProduction(e) && !demoEscapeHatch(e)) {
    throw new Error("Refusing to run the demo seed in production. Set ALLOW_DEMO_IN_PRODUCTION=true only on a staging / demo deployment (UNSAFE).");
  }
}

/** Throws ProductionConfigError listing every problem; a no-op outside production. */
export function assertProductionEnv(e: EnvLike = process.env): void {
  const problems = productionProblems(e);
  if (problems.length) throw new ProductionConfigError(problems);
  if (isProduction(e) && demoEscapeHatch(e)) {
    console.warn("[startup] ALLOW_DEMO_IN_PRODUCTION=true: demo / mock safeguards are OFF. Do not use real client data on this deployment.");
  }
}
