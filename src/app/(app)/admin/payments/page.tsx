import { requireFinancePage } from "@/server/finance/guard";
import { awaitingApproval, paymentsDashboard } from "@/server/finance/queries";
import { getSettings } from "@/lib/settings";
import { PaymentsDashboardView } from "@/components/finance/PaymentsDashboardView";
import { PAYMENT_METHODS, type PaymentMethod } from "@/components/finance/finance-ui";

export const dynamic = "force-dynamic";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Payments dashboard (ADR 0005). ADMIN only. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ month?: string; method?: string }> }) {
  await requireFinancePage();
  const sp = await searchParams;
  const month = sp.month && MONTH.test(sp.month) ? sp.month : null;
  const method = PAYMENT_METHODS.includes(sp.method as PaymentMethod) ? (sp.method as PaymentMethod) : null;
  const [data, awaiting, settings] = await Promise.all([paymentsDashboard({ month, method }), awaitingApproval(), getSettings()]);
  return <PaymentsDashboardView data={data} awaiting={awaiting} method={method} tz={settings.timezone} />;
}
