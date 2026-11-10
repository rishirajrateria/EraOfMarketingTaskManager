import { describe, it, expect } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import { assertProductionEnv, assertSeedAllowed, demoLoginAllowed, isValidVaultKey, productionProblems, ProductionConfigError, PUBLIC_DEFAULT_SECRETS, strictVaultKey } from "@/lib/prod-guards";
import { MOCK_LOG_LIMIT, pushCapped } from "@/lib/capped-log";

/** ADR 0020: production start-up guards are pure functions over an env object. */
const KEY = Buffer.alloc(32, 7).toString("base64");
const good = { NODE_ENV: "production", GOOGLE_MOCK: "false", AUTH_SECRET: "x".repeat(40), VAULT_ENCRYPTION_KEY: KEY, CRON_SECRET: "c".repeat(30) };

describe("production guards", () => {
  it("does nothing outside production", () => {
    expect(productionProblems({ NODE_ENV: "development" })).toEqual([]);
    expect(productionProblems({})).toEqual([]);
    expect(() => assertProductionEnv({ NODE_ENV: "test", GOOGLE_MOCK: "true", DEMO_LOGIN: "true" })).not.toThrow();
  });

  it("accepts a correct production environment", () => {
    expect(productionProblems(good)).toEqual([]);
    expect(() => assertProductionEnv(good)).not.toThrow();
  });

  it("refuses to start when GOOGLE_MOCK is unset or anything but 'false'", () => {
    const { GOOGLE_MOCK: _omit, ...unset } = good;
    expect(productionProblems(unset).join()).toMatch(/GOOGLE_MOCK/);
    expect(productionProblems({ ...good, GOOGLE_MOCK: "true" }).join()).toMatch(/GOOGLE_MOCK/);
    expect(productionProblems({ ...good, GOOGLE_MOCK: "False" }).join()).toMatch(/GOOGLE_MOCK/);
    expect(() => assertProductionEnv(unset)).toThrow(ProductionConfigError);
    expect(() => assertProductionEnv(unset)).toThrow(/Refusing to start in production/);
  });

  it("refuses DEMO_LOGIN=true", () => {
    expect(productionProblems({ ...good, DEMO_LOGIN: "true" }).join()).toMatch(/DEMO_LOGIN/);
    expect(productionProblems({ ...good, DEMO_LOGIN: "false" })).toEqual([]);
  });

  it("refuses missing or publicly known AUTH_SECRET, VAULT_ENCRYPTION_KEY and CRON_SECRET", () => {
    for (const name of ["AUTH_SECRET", "VAULT_ENCRYPTION_KEY", "CRON_SECRET"] as const) {
      expect(productionProblems({ ...good, [name]: undefined }).join()).toContain(`${name} is not set`);
      expect(productionProblems({ ...good, [name]: "  " }).join()).toContain(`${name} is not set`);
    }
    expect(productionProblems({ ...good, AUTH_SECRET: "local-dev-secret-change-me-0123456789abcdef" }).join()).toMatch(/AUTH_SECRET.*publicly known/);
    expect(productionProblems({ ...good, CRON_SECRET: "local-dev-cron" }).join()).toMatch(/CRON_SECRET.*publicly known/);
    expect(productionProblems({ ...good, VAULT_ENCRYPTION_KEY: "bG9jYWwtZGV2LXZhdWx0LWtleS1jaGFuZ2UtbWUtMDEyMzQ1Njc4OQ==" }).join()).toMatch(/VAULT_ENCRYPTION_KEY.*publicly known/);
    for (const v of PUBLIC_DEFAULT_SECRETS) expect(productionProblems({ ...good, AUTH_SECRET: v }).length).toBeGreaterThan(0);
  });

  it("requires the vault key to be base64 of exactly 32 bytes", () => {
    expect(isValidVaultKey(KEY)).toBe(true);
    expect(isValidVaultKey("short")).toBe(false);
    expect(isValidVaultKey(Buffer.alloc(16).toString("base64"))).toBe(false);
    expect(isValidVaultKey(Buffer.alloc(33).toString("base64"))).toBe(false);
    expect(isValidVaultKey("not base64 !!! ".repeat(4))).toBe(false);
    expect(isValidVaultKey(undefined)).toBe(false);
    expect(productionProblems({ ...good, VAULT_ENCRYPTION_KEY: "a-passphrase-that-would-be-hashed-in-dev" }).join()).toMatch(/32 bytes/);
  });

  it("lists every problem at once", () => {
    expect(productionProblems({ NODE_ENV: "production" }).length).toBe(4);
  });

  it("ALLOW_DEMO_IN_PRODUCTION relaxes mock / demo / key-format only, never missing or default secrets", () => {
    const demo = { NODE_ENV: "production", ALLOW_DEMO_IN_PRODUCTION: "true", GOOGLE_MOCK: "true", DEMO_LOGIN: "true", AUTH_SECRET: "a".repeat(32), CRON_SECRET: "b".repeat(32), VAULT_ENCRYPTION_KEY: "any-string-hashed-like-dev" };
    expect(productionProblems(demo)).toEqual([]);
    expect(productionProblems({ ...demo, AUTH_SECRET: "replace-me" }).length).toBe(1);
    expect(productionProblems({ ...demo, CRON_SECRET: undefined }).length).toBe(1);
    expect(productionProblems({ ...demo, ALLOW_DEMO_IN_PRODUCTION: "yes" }).length).toBeGreaterThan(0);
  });

  it("gates demo login: only DEMO_LOGIN=true, and never in production without the hatch", () => {
    expect(demoLoginAllowed({ DEMO_LOGIN: "true" })).toBe(true);
    expect(demoLoginAllowed({ NODE_ENV: "development", DEMO_LOGIN: "true" })).toBe(true);
    expect(demoLoginAllowed({ NODE_ENV: "development" })).toBe(false);
    expect(demoLoginAllowed({ NODE_ENV: "production", DEMO_LOGIN: "true" })).toBe(false);
    expect(demoLoginAllowed({ NODE_ENV: "production", DEMO_LOGIN: "true", ALLOW_DEMO_IN_PRODUCTION: "true" })).toBe(true);
    expect(demoLoginAllowed({ NODE_ENV: "production", ALLOW_DEMO_IN_PRODUCTION: "true" })).toBe(false);
  });

  it("strict vault key mode applies in production unless the hatch is set (no silent SHA-256)", () => {
    expect(strictVaultKey({ NODE_ENV: "production" })).toBe(true);
    expect(strictVaultKey({ NODE_ENV: "production", ALLOW_DEMO_IN_PRODUCTION: "true" })).toBe(false);
    expect(strictVaultKey({ NODE_ENV: "development" })).toBe(false);
  });

  it("the production start fails fast: `node` against the guard with GOOGLE_MOCK unset exits non-zero", () => {
    const script = 'require("tsx/cjs"); require("./src/lib/prod-guards.ts").assertProductionEnv(process.env)';
    const root = path.resolve(__dirname, "../..");
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? "", NODE_ENV: "production" as const, AUTH_SECRET: "x".repeat(40), VAULT_ENCRYPTION_KEY: KEY, CRON_SECRET: "c".repeat(30) };
    const bad = spawnSync(process.execPath, ["-e", script], { cwd: root, env, encoding: "utf8" });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/Refusing to start in production[\s\S]*GOOGLE_MOCK/);
    const ok = spawnSync(process.execPath, ["-e", script], { cwd: root, env: { ...env, GOOGLE_MOCK: "false" }, encoding: "utf8" });
    expect(ok.status).toBe(0);
  });
});

describe("seed guard", () => {
  it("refuses to seed in production unless ALLOW_DEMO_IN_PRODUCTION=true", () => {
    expect(() => assertSeedAllowed({ NODE_ENV: "production" })).toThrow(/Refusing to run the demo seed in production/);
    expect(() => assertSeedAllowed({ NODE_ENV: "production", SEED_DEMO: "true" })).toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_IN_PRODUCTION: "true" })).not.toThrow();
    expect(() => assertSeedAllowed({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertSeedAllowed({})).not.toThrow();
  });

  it("`tsx prisma/seed.ts` with NODE_ENV=production exits non-zero before touching the database", () => {
    const root = path.resolve(__dirname, "../..");
    const r = spawnSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "prisma/seed.ts"], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" as const, DATABASE_URL: "postgresql://nobody:none@127.0.0.1:1/none" },
      encoding: "utf8",
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Refusing to run the demo seed in production/);
  });
});

describe("capped mock logs", () => {
  it("keeps only the most recent entries", () => {
    const log: number[] = [];
    for (let i = 0; i < MOCK_LOG_LIMIT + 50; i++) pushCapped(log, i);
    expect(log).toHaveLength(MOCK_LOG_LIMIT);
    expect(log[0]).toBe(50);
    expect(log.at(-1)).toBe(MOCK_LOG_LIMIT + 49);
    expect(MOCK_LOG_LIMIT).toBe(200);
  });

  it("the mock mail and WhatsApp logs are capped", async () => {
    const { sendWhatsapp, sentWhatsappLog } = await import("@/integrations/whatsapp");
    sentWhatsappLog.length = 0;
    for (let i = 0; i < 205; i++) await sendWhatsapp({ to: "+919876543210", body: `m${i}` });
    expect(sentWhatsappLog).toHaveLength(200);
    expect(sentWhatsappLog.at(-1)!.body).toBe("m204");
    sentWhatsappLog.length = 0;
  });
});
