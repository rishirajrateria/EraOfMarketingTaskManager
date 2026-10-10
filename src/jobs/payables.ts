import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { adminIds, remind as sendReminder } from "@/lib/notify";
import { dateKey } from "@/lib/time";
import { formatCurrency } from "@/server/finance/money";
import { addDaysKey } from "@/server/finance/repeat";
import { createNextOccurrence } from "@/server/finance/payables-core";

/**
 * Payables job (ADR 0009, prototype `expenseTick`). Idempotent; every step changes the state it selects on.
 *  (a) A recurring bill with nothing DUE gets its next occurrence once the last paid due date is within `remindDays`
 *      of today (paying a recurring bill normally creates the next one right away; this catches the rest).
 *  (b) Each DUE occurrence notifies the admins once, when `dueDate − remindDays ≤ today`:
 *      "Payment due in 3 days: Skyline Spaces ₹25,000 (Part 1 of 2) · Rent" / "Overdue: …".
 */
export type PayablesJobResult = { created: number; reminded: number };

const DAY_MS = 86_400_000;
const dayDiff = (key: string, today: string) => Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

export function dueWords(days: number): string {
  if (days < 0) return `${-days} day${days === -1 ? "" : "s"} overdue`;
  if (days === 0) return "due today";
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

/** Notification title for a payment `days` away from today (negative = overdue). */
export function reminderTitle(days: number, payee: string, amount: number, label: string | null, category: string): string {
  const what = `${payee} ${formatCurrency(amount)}${label ? ` (${label})` : ""} · ${category}`;
  return days < 0 ? `Overdue: ${what}` : `Payment ${dueWords(days)}: ${what}`;
}

async function materialise(today: string, tz: string): Promise<number> {
  const bills = await prisma.expense.findMany({
    where: { plan: "RECURRING", occurrences: { none: { status: "DUE" } } },
    include: { occurrences: { orderBy: [{ dueDate: "desc" }, { seq: "desc" }], take: 1 } },
  });
  let created = 0;
  for (const b of bills) {
    const last = b.occurrences[0];
    if (!last || last.status !== "PAID" || dateKey(last.dueDate, tz) > addDaysKey(today, b.remindDays)) continue;
    try {
      const n = await prisma.$transaction(async (tx) => {
        if ((await tx.expenseOccurrence.count({ where: { expenseId: b.id, status: "DUE" } })) > 0) return null;
        return createNextOccurrence(tx, b, last.dueDate, tz);
      });
      if (n) created++;
    } catch (e) {
      console.error("[jobs/payables] next occurrence failed", b.id, e);
    }
  }
  return created;
}

async function remind(today: string, tz: string): Promise<number> {
  const horizon = new Date(Date.parse(`${addDaysKey(today, 61)}T00:00:00Z`));
  const due = await prisma.expenseOccurrence.findMany({
    where: { status: "DUE", notifiedAt: null, dueDate: { lt: horizon } },
    include: { expense: { select: { vendor: true, category: true, remindDays: true } } },
    orderBy: { dueDate: "asc" },
  });
  const admins = await adminIds();
  let reminded = 0;
  for (const o of due) {
    const days = dayDiff(dateKey(o.dueDate, tz), today);
    if (days > o.expense.remindDays) continue;
    const claimed = await prisma.expenseOccurrence.updateMany({ where: { id: o.id, notifiedAt: null, status: "DUE" }, data: { notifiedAt: new Date() } });
    if (claimed.count === 0) continue;
    // A bill to pay is a decision (Requests → Finance): push / email reminder only, no feed row (ADR 0017).
    await sendReminder({ userIds: admins, kind: "PAYMENT_DUE", title: reminderTitle(days, o.expense.vendor ?? "Payee", o.amount.toNumber(), o.label, o.expense.category), body: "", href: "/admin/expenses" });
    reminded++;
  }
  return reminded;
}

export async function run(now = new Date()): Promise<PayablesJobResult> {
  const tz = (await getSettings()).timezone;
  const today = dateKey(now, tz);
  const created = await materialise(today, tz);
  const reminded = await remind(today, tz);
  return { created, reminded };
}
