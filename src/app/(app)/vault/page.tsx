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
  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-brand-blue-dark px-4 py-2 text-white">
        <h1 className="text-base font-semibold">Client Vault</h1>
        <p className="text-[11px] text-white/70">Only items Admin has shared with you. Every reveal is logged.</p>
      </div>
      <GrantedVault groups={groups} />
    </div>
  );
}
