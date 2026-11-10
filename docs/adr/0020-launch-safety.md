# ADR 0020 — Launch safety

- Status: Accepted
- Date: 2026-11-06
- Extends: ADR 0003 (Google integration), ADR 0013 / 0014 (client kit, Drive sharing), ADR 0015 (Google lifecycle)
- Code: `src/lib/prod-guards.ts`, `src/instrumentation.ts`, `src/lib/crypto.ts`, `src/server/demo-login.ts`,
  `prisma/seed.ts`, `prisma/seed-company.ts`, `next.config.ts`, `src/app/{error,global-error,not-found}.tsx`,
  `src/google/job-failure.ts`, `src/google/queue.ts`, `src/server/clients/kit-client-share.ts`, `src/server/vault/url.ts`

## Context
The app is going live with real client data on Render (paid, always on, managed Postgres). It shipped with demo and mock
behaviour on by default, public default secrets in `docker-compose.yml`, a seed that overwrote company settings, a
client who was Editor on the whole Drive kit (including task folders and Gemini meeting notes), and silent failures
of Google jobs.

## Decisions
1. **Fail fast in production.** At boot (`instrumentation.ts`), with `NODE_ENV=production`, the server refuses to start
   if `GOOGLE_MOCK` is not exactly `false`, `DEMO_LOGIN=true`, `AUTH_SECRET` / `VAULT_ENCRYPTION_KEY` / `CRON_SECRET` is
   missing or a known public default, or the vault key is not base64 of 32 bytes (no silent SHA-256 in production;
   development keeps it). Demo login is also gated in `demo-login.ts`.
2. **One explicit escape hatch**: `ALLOW_DEMO_IN_PRODUCTION=true` for staging / demo deployments. It relaxes mock-Google,
   demo-login and the vault-key format, and allows the seed. It never excuses missing or default secrets. Documented as unsafe.
3. **Seed safety.** The seed refuses to run in production without the hatch and creates `CompanySettings` only if absent;
   the owner's company and bank details are demo defaults on first create, never re-applied. Dockerfile, `render.yaml`
   and compose default `DEMO_LOGIN`, `SEED_DEMO` and `GOOGLE_MOCK` to off; compose requires the three secrets.
4. **Mock logs** (mail, WhatsApp, share notifications, sheets) keep the last 200 entries.
5. **Error pages and headers.** Friendly glass-style `error`, `global-error` and `not-found` pages that never print a stack
   trace in production. Headers: `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (`no-referrer` on `/c/*`),
   `X-Frame-Options: DENY` plus CSP `frame-ancestors 'none'` only (no script CSP: it would break Next's inline hydration
   scripts), `Permissions-Policy` camera and geolocation off with microphone kept for voice notes, HSTS in production,
   no `X-Powered-By`.
6. **Failed Google jobs** are visible: reaching FAILED notifies Admins once (task title and step: Drive, Calendar, Meet,
   Chat), and Settings → Google lists them with Retry (existing retry) and Dismiss. Logs are kept.
7. **Vault**: link must be http(s), validated on the server (and never rendered otherwise); Admin sees "Viewed by"
   (person, count, last time) from `VaultViewLog`.
8. **Client Drive is client-facing only** (owner's choice). The client is shared on *Brand kit* (Editor), the *Credentials
   sheet* (Editor), *Reports* (Viewer) and a new *Final work* folder (Viewer; `Client.kitFinalId`), never the kit root,
   the Credentials folder or *Work*. The tracking page's Drive button opens *Final work* and also lists Brand kit and
   Reports. *Fix sharing* (and Repair) removes the client from the root and Work and adds the client-facing items. A
   changed client email revokes the old address everywhere; deactivating a client revokes all client access. A failed
   revoke is kept in `kitSharedWith` and retried by the next Fix sharing.

## Consequences
- A misconfigured deploy fails loudly at boot instead of running with fake Google or open demo login.
- Existing kits are "incomplete" until Repair / Fix sharing creates *Final work* and removes the old whole-kit access.
- Revocation needs Drive to be reachable; failures surface as warnings and audit entries, not silently.
- The owner must keep an offline copy of `VAULT_ENCRYPTION_KEY`; passwords cannot be recovered without it.
