import { requireFinancePage } from "@/server/finance/guard";
import { listExpenses } from "@/server/finance/queries";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { ExpensesView } from "@/components/finance/ExpensesView";

export const dynamic = "force-dynamic";

/** Expense log (SPEC §11.2). ADMIN only. */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ month?: string; category?: string }> }) {
  const user = await requireFinancePage();
  const settings = await getSettings();
  const sp = await searchParams;
  const month = sp.month === undefined ? fmtDate(new Date(), settings.timezone, "yyyy-MM") : /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : "";
  const category = sp.category?.trim() || null;
  const { rows, total } = await listExpenses({ month: month || null, category });
  return <ExpensesView rows={rows} total={total} categories={settings.expenseCategories} month={month} category={category} canWrite={user.canWrite} tz={settings.timezone} />;
}
