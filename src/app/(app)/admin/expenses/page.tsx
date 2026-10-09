import { requireFinancePage } from "@/server/finance/guard";
import { listBills } from "@/server/finance/payables-queries";
import { tdsSummary, vendorTdsSummary } from "@/server/finance/tds";
import { ensureMonthFolder, monthFolderUrls } from "@/server/finance/month-folders";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { ExpensesView } from "@/components/finance/ExpensesView";
import { EXPENSE_TABS, type ExpenseTab } from "@/components/finance/payables/payables-ui";

export const dynamic = "force-dynamic";

/** Expenses = payables (ADR 0009): bills, what is due, what was paid, GST credit and TDS by payee. ADMIN only. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string }> }) {
  const user = await requireFinancePage();
  const settings = await getSettings();
  const sp = await searchParams;
  const today = dateKey(new Date(), settings.timezone);
  const tab = (EXPENSE_TABS.some(([k]) => k === sp.tab) ? sp.tab : "DUE") as ExpenseTab;
  const gstMonth = sp.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [bills, tds, fy] = await Promise.all([listBills(), vendorTdsSummary(), tdsSummary()]);
  let itcFolderUrl: string | null = null;
  if (tab === "GST") {
    try {
      itcFolderUrl = monthFolderUrls(await ensureMonthFolder(gstMonth)).itc;
    } catch {
      itcFolderUrl = null; // Drive unavailable: the Drive button is hidden
    }
  }
  return <ExpensesView bills={bills} today={today} tab={tab} gstMonth={gstMonth} tds={tds} tdsFy={fy.onExpenses} financeEmail={settings.financeEmail} itcFolderUrl={itcFolderUrl} canWrite={user.canWrite} />;
}
