import { requireFinancePage } from "@/server/finance/guard";
import { listBills, salaryPeople } from "@/server/finance/payables-queries";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { BillEditor } from "@/components/finance/payables/BillEditor";

export const dynamic = "force-dynamic";

/** Add expense (ADR 0009 bill editor). ADMIN only. */
export default async function NewBillPage() {
  await requireFinancePage();
  const settings = await getSettings();
  const [bills, staff] = await Promise.all([listBills(), salaryPeople()]);
  const payees = Array.from(new Set(bills.filter((b) => b.kind === "REGULAR").map((b) => b.payee).filter(Boolean)));
  return <BillEditor bill={null} categories={settings.expenseCategories} staff={staff} payees={payees} today={dateKey(new Date(), settings.timezone)} />;
}
