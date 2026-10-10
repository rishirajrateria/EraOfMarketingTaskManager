import { addDays } from "date-fns";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, zonedStartOfDay } from "@/lib/time";

/**
 * "Needs you" on the Payments & finance hub (ADR 0013): vendor bills that are overdue or due within 7 days (the same
 * window as the menu's "due this week"). Client invoices overdue and approvals come from the payments dashboard.
 */
export type BillDueRow = { occId: string; billId: string; payee: string; label: string | null; category: string; amount: number; dueKey: string; overdue: boolean };

export async function billsNeedingPayment(now = new Date()): Promise<BillDueRow[]> {
  const tz = (await getSettings()).timezone;
  const today = zonedStartOfDay(now, tz);
  const rows = await prisma.expenseOccurrence.findMany({
    where: { status: "DUE", dueDate: { lt: addDays(today, 8) } },
    orderBy: { dueDate: "asc" },
    take: 30,
    select: { id: true, expenseId: true, label: true, amount: true, dueDate: true, expense: { select: { vendor: true, category: true } } },
  });
  return rows.map((o) => ({
    occId: o.id,
    billId: o.expenseId,
    payee: o.expense.vendor ?? o.expense.category,
    label: o.label,
    category: o.expense.category,
    amount: o.amount.toNumber(),
    dueKey: dateKey(o.dueDate, tz),
    overdue: o.dueDate < today,
  }));
}
