import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireFinancePage } from "@/server/finance/guard";
import { clientLedger } from "@/server/finance/queries";
import { getSettings } from "@/lib/settings";
import { ClientLedgerView } from "@/components/finance/ClientLedgerView";

export const dynamic = "force-dynamic";

/** Client ledger: approved invoices against payments, TDS and credit notes with a running balance. */
export default async function ClientLedgerPage({ params }: { params: Promise<{ clientId: string }> }) {
  await requireFinancePage();
  const { clientId } = await params;
  const [ledger, settings, client] = await Promise.all([clientLedger(clientId), getSettings(), prisma.client.findUnique({ where: { id: clientId }, select: { workOnHold: true } })]);
  if (!ledger) notFound();
  return <ClientLedgerView ledger={ledger} tz={settings.timezone} onHold={client?.workOnHold ?? false} />;
}
