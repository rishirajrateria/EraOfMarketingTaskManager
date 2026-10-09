import { requireAdminPage } from "@/server/admin/guard";
import { listClients } from "@/server/admin/queries";
import { getSettings } from "@/lib/settings";
import { companyStateCode } from "@/server/finance/tax";
import { ClientsManager } from "@/components/admin/ClientsManager";

/** Add Client (SPEC §11.1). */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  await requireAdminPage();
  const [clients, sp, settings] = await Promise.all([listClients(), searchParams, getSettings()]);
  return <ClientsManager clients={clients} openAdd={sp.add === "1"} companyStateCode={companyStateCode(settings)} />;
}
