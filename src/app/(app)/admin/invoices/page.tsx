import type { InvoiceStatus } from "@prisma/client";
import { requireFinancePage } from "@/server/finance/guard";
import { listClientsForInvoice, listInvoices } from "@/server/finance/queries";
import { getSettings } from "@/lib/settings";
import { InvoiceListView } from "@/components/finance/InvoiceListView";

export const dynamic = "force-dynamic";
const STATUSES = new Set<string>(["DRAFT", "SCHEDULED", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"]);

/** Payment Creator (SPEC §11.3). ADMIN only. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireFinancePage();
  const { status: raw } = await searchParams;
  const status = raw && STATUSES.has(raw) ? (raw as InvoiceStatus) : null;
  const [rows, clients, settings] = await Promise.all([listInvoices({ status }), listClientsForInvoice(), getSettings()]);
  return (
    <InvoiceListView rows={rows} status={status} clients={clients} defaultGst={settings.defaultGstPercent.toNumber()} defaultTerms={settings.invoiceTerms} canWrite={user.canWrite} tz={settings.timezone} />
  );
}
