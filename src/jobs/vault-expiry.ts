import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { grantExpiresAt, grantIsActive } from "@/server/vault/access";

const WARN_WINDOW_MS = 30 * 60_000;

/**
 * Vault grant housekeeping (SPEC §10 "vault access expiring", §11.1 "expired users lose access").
 * - Grants expiring within 30 minutes that have not been warned → notify VAULT_ACCESS_EXPIRING once.
 * - Grants already expired (per grantIsActive) but not yet revoked → mark revoked so they disappear
 *   from lists. Access is already refused server-side before this runs; this is cleanup + audit.
 */
export async function run(now = new Date()): Promise<{ notified: number; expired: number }> {
  const grants = await prisma.vaultAccessGrant.findMany({
    where: { revoked: false, OR: [{ expiresAt: { not: null } }, { expiresAfterFirstOpenMinutes: { not: null }, firstOpenedAt: { not: null } }] },
    include: { vaultItem: { select: { label: true, client: { select: { name: true } } } } },
  });
  let notified = 0;
  let expired = 0;
  for (const g of grants) {
    if (!grantIsActive(g, now)) {
      await prisma.vaultAccessGrant.update({ where: { id: g.id }, data: { revoked: true } });
      await audit(null, "vault.grant.expired", "VaultAccessGrant", g.id, { revoked: false }, { revoked: true, expiredAt: grantExpiresAt(g) });
      expired++;
      continue;
    }
    const exp = grantExpiresAt(g);
    if (!exp || g.expiringNotifiedAt) continue;
    if (exp.getTime() - now.getTime() > WARN_WINDOW_MS) continue;
    await notify({
      userIds: [g.userId],
      kind: "VAULT_ACCESS_EXPIRING",
      title: "Vault access expiring soon",
      body: `${g.vaultItem.label} (${g.vaultItem.client.name}) expires at ${exp.toISOString()}`,
      href: "/vault",
    });
    await prisma.vaultAccessGrant.update({ where: { id: g.id }, data: { expiringNotifiedAt: now } });
    notified++;
  }
  return { notified, expired };
}
