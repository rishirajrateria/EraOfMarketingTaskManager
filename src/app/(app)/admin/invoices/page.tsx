import { requireFinancePage } from "@/server/finance/guard";
import { listClientsForInvoice, listInvoices } from "@/server/finance/queries";
import { getSettings } from "@/lib/settings";
import { companyStateCode } from "@/server/finance/tax";
import { InvoiceListView } from "@/components/finance/InvoiceListView";
import { INVOICE_TABS, type InvoiceTab } from "@/components/finance/invoice-list-helpers";

export const dynamic = "force-dynamic";

/** Payment Creator (SPEC §11.3, ADR 0005). ADMIN only. */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ tab?: string; new?: string }> }) {
  const user = await requireFinancePage();
  const sp = await searchParams;
  const tab = (INVOICE_TABS.some((t) => t.key === sp.tab) ? sp.tab : "all") as InvoiceTab;
  const [rows, clients, settings] = await Promise.all([listInvoices(), listClientsForInvoice(), getSettings()]);
  return (
    <InvoiceListView
      rows={rows}
      tab={tab}
      clients={clients}
      companyStateCode={companyStateCode(settings)}
      defaultGst={settings.defaultGstPercent.toNumber()}
      defaultTerms={settings.invoiceTerms}
      canWrite={user.canWrite}
      tz={settings.timezone}
      openNew={sp.new === "1"}
      holdClientIds={clients.filter((c) => c.workOnHold).map((c) => c.id)}
    />
  );
}
