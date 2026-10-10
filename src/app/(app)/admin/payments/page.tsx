import { requireFinancePage } from "@/server/finance/guard";
import { awaitingApproval, financeSummary, paymentsDashboard } from "@/server/finance/queries";
import { fyRange, tdsSummary } from "@/server/finance/tds";
import { payablesTiles } from "@/server/finance/payables-queries";
import { billsNeedingPayment } from "@/server/finance/hub-queries";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { PaymentsDashboardView } from "@/components/finance/PaymentsDashboardView";
import { NeedsYou } from "@/components/finance/hub/NeedsYou";
import { FinanceSummary } from "@/components/finance/hub/FinanceSummary";
import { FinanceSheetActions } from "@/components/finance/FinanceActions";
import { PAYMENT_METHODS, type PaymentMethod } from "@/components/finance/finance-ui";

export const dynamic = "force-dynamic";
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Payments & finance hub (ADR 0005, ADR 0013): Needs you (approvals, overdue client invoices, bills due), the finance
 * summary that used to be the separate Finance sheet (totals, TDS, GST), then the payments lists. ADMIN only.
 */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ month?: string; method?: string; fy?: string }> }) {
  const user = await requireFinancePage();
  const sp = await searchParams;
  const month = sp.month && MONTH.test(sp.month) ? sp.month : null;
  const method = PAYMENT_METHODS.includes(sp.method as PaymentMethod) ? (sp.method as PaymentMethod) : null;
  const previousFy = sp.fy === "previous";
  const settings = await getSettings();
  const tz = settings.timezone;
  const now = new Date();
  // ADR 0006: TDS for the current FY, or the previous one (any instant before this FY's 1 April).
  const tdsAt = previousFy ? new Date(fyRange(now, tz).start.getTime() - 1) : now;
  const [data, awaiting, bills, summary, tds, pay] = await Promise.all([
    paymentsDashboard({ month, method }),
    awaitingApproval(),
    billsNeedingPayment(now),
    financeSummary(now),
    tdsSummary(tdsAt),
    payablesTiles(now),
  ]);
  return (
    <PaymentsDashboardView
      data={data}
      method={method}
      tz={tz}
      needs={<NeedsYou key="needs" awaiting={awaiting} overdue={data.overdue} bills={bills} tz={tz} />}
      summary={<FinanceSummary key="summary" summary={summary} tds={tds} pay={pay} previousFy={previousFy} actions={<FinanceSheetActions canWrite={user.canWrite} sheetId={env.financeSheetId} />} />}
    />
  );
}
