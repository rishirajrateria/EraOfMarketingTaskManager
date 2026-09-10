import { requireAdminPage } from "@/server/admin/guard";
import { listClients } from "@/server/admin/queries";
import { ClientsManager } from "@/components/admin/ClientsManager";

/** Add Client (SPEC §11.1). */
export default async function ClientsPage() {
  await requireAdminPage();
  const clients = await listClients();
  return <ClientsManager clients={clients} />;
}
