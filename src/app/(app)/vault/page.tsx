import { redirect } from "next/navigation";
import { currentUser } from "@/lib/rbac";
import { listGrantedItems } from "@/server/vault/queries";
import { GrantedVault } from "@/components/vault/GrantedVault";

export const dynamic = "force-dynamic";

/** Vault for granted users (SPEC §2 "granted only"). Admin manages everything at /admin/vault. */
export default async function VaultPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role === "ADMIN") redirect("/admin/vault");
  const groups = await listGrantedItems(user.id);
  return <GrantedVault groups={groups} isAdmin={false} />;
}
