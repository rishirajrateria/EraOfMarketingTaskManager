import { redirect } from "next/navigation";
import type { VaultItemKind } from "@prisma/client";
import { currentUser } from "@/lib/rbac";
import { listGrantableUsers, listVaultClients, listVaultItems, VAULT_KINDS } from "@/server/vault/queries";
import { AdminVault } from "@/components/vault/AdminVault";

export const dynamic = "force-dynamic";

type Search = { clientId?: string; tab?: string };

/** Admin Client Vault (SPEC §11.1): /admin/vault?clientId=&tab=ASSET_DRIVE_LINK|CREDENTIAL|SHARED_DRIVE_LINK */
export default async function AdminVaultPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/vault");

  const sp = await searchParams;
  const tab: VaultItemKind = VAULT_KINDS.includes(sp.tab as VaultItemKind) ? (sp.tab as VaultItemKind) : "ASSET_DRIVE_LINK";
  const [clients, users] = await Promise.all([listVaultClients(), listGrantableUsers()]);
  const clientId = clients.some((c) => c.id === sp.clientId) ? sp.clientId! : (clients[0]?.id ?? null);
  const items = clientId ? await listVaultItems(clientId, tab) : [];

  return <AdminVault clients={clients} users={users} clientId={clientId} tab={tab} items={items} />;
}
