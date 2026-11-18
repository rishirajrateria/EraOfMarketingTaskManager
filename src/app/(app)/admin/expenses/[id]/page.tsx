import { notFound } from "next/navigation";
import { requireFinancePage } from "@/server/finance/guard";
import { listBills, salaryPeople } from "@/server/finance/payables-queries";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { BillEditor } from "@/components/finance/payables/BillEditor";

export const dynamic = "force-dynamic";

/** Edit a bill (ADR 0009 bill editor; schedule frozen once a payment is recorded). ADMIN only. */
export default async function EditBillPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFinancePage();
  const { id } = await params;
  const settings = await getSettings();
  const [bills, staff] = await Promise.all([listBills(), salaryPeople()]);
  const bill = bills.find((b) => b.id === id);
  if (!bill) notFound();
  const payees = Array.from(new Set(bills.filter((b) => b.kind === "REGULAR").map((b) => b.payee).filter(Boolean)));
  return <BillEditor bill={bill} categories={settings.expenseCategories} staff={staff} payees={payees} today={dateKey(new Date(), settings.timezone)} />;
}
