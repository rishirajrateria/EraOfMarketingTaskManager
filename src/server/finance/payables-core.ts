import { Prisma, type Expense, type ExpenseOccurrence } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";
import { dateKey, parseDateKey, zonedDayAt } from "@/lib/time";
import { adminIds, notify } from "@/lib/notify";
import { round2 } from "@/server/finance/money";
import { nextDateKey } from "@/server/finance/repeat";
import { repeatRuleSchema, type BillInput, type RepeatRule } from "@/server/finance/schemas";
import { tdsThresholdStatus } from "@/server/finance/tds";
import { trashQuietly } from "@/server/finance/month-folders";

/**
 * Payables (ADR 0009): an Expense row is a bill (one-time, recurring or in parts); each payment due is an
 * ExpenseOccurrence that is DUE until marked PAID. This module owns bill creation / editing and the shared helpers
 * (due-date conversion, the next recurring occurrence, the payee TDS threshold check). No auth — callers check RBAC.
 */
type Tx = Prisma.TransactionClient | typeof prisma;
const D = (n: number) => new Prisma.Decimal(round2(n));

export const BALANCE_PREFIX = "Balance of ";

export async function companyTz(): Promise<string> {
  return (await getSettings()).timezone;
}

/** Due dates are stored as the start of the due day in the company timezone. */
export const dueFromKey = (key: string, tz: string) => parseDateKey(key, tz);
/** Payments are stamped at noon of the paid day (company timezone) so the calendar day never drifts. */
export const paidAtFromKey = (key: string, tz: string) => zonedDayAt(parseDateKey(key, tz), 12 * 60, tz);

export function parseRule(raw: Prisma.JsonValue | null | undefined): RepeatRule | null {
  if (!raw) return null;
  const r = repeatRuleSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Payments counted against a COUNT-limited rule: balance rows left by a part payment are not new cycles. */
export const cycleCount = (occ: Pick<ExpenseOccurrence, "label">[]) => occ.filter((o) => !o.label?.startsWith(BALANCE_PREFIX)).length;

/** Category must be in the Settings list (ADR 0004); returns the listed spelling. */
export async function canonicalCategory(name: string): Promise<string> {
  const allowed = (await getSettings()).expenseCategories;
  const hit = allowed.find((c) => c.toLowerCase() === name.trim().toLowerCase());
  if (!hit) throw new Error(`category: "${name}" is not in the expense category list (Settings → Expenses)`);
  return hit;
}

/** Salary bills are paid to an active team member (not Admin); the payee is their name. */
async function resolvePayee(input: BillInput): Promise<{ vendor: string; salaryUserId: string | null }> {
  if (input.kind !== "SALARY") return { vendor: input.payee.trim(), salaryUserId: null };
  const u = await prisma.user.findUnique({ where: { id: input.salaryUserId! }, select: { id: true, name: true, role: true, active: true } });
  if (!u || !u.active || u.role === "ADMIN") throw new Error("Pick the team member");
  return { vendor: u.name, salaryUserId: u.id };
}

type NewOccurrence = Omit<Prisma.ExpenseOccurrenceCreateManyInput, "expenseId">;

/** The occurrences a fresh schedule starts with (prototype `billEditor` → saveBill). */
export function scheduleOccurrences(input: BillInput, tz: string, now: Date): NewOccurrence[] {
  if (input.plan === "PART") {
    const n = input.parts.length;
    let left = round2(input.amount);
    return input.parts.map((p, i) => {
      const amount = input.partMode === "PERCENT" ? (i === n - 1 ? left : round2((input.amount * p.value) / 100)) : round2(p.value);
      left = round2(left - amount);
      return { seq: i + 1, label: `Part ${i + 1} of ${n}${p.note ? ` · ${p.note}` : ""}`, amount: D(amount), dueDate: dueFromKey(p.dueDate, tz) };
    });
  }
  const due = dueFromKey(input.dueDate!, tz);
  if (input.plan === "ONE_TIME" && input.alreadyPaid) {
    // "Already paid": stamped on the due day when that is today or earlier (back-filling a past bill), else now.
    const paidAt = input.dueDate! <= dateKey(now, tz) ? paidAtFromKey(input.dueDate!, tz) : now;
    return [{ seq: 1, amount: D(input.amount), dueDate: due, status: "PAID", paidAt, method: input.paidMethod, notifiedAt: now }];
  }
  return [{ seq: 1, amount: D(input.amount), dueDate: due }];
}

const ruleJson = (input: BillInput): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  input.plan === "RECURRING" && input.rule ? ({ ...input.rule, anchorDate: input.dueDate } as Prisma.InputJsonValue) : Prisma.DbNull;

/**
 * After the TDS-relevant payment `occurrenceId`: when a regular payee is at/over the FY threshold and no TDS was
 * deducted, every admin is notified (ADR 0006 wording) and the warning text is returned.
 */
export async function tdsCheckAfterPayment(bill: Pick<Expense, "kind" | "vendor">, paidAt: Date, tdsAmount: number): Promise<string | null> {
  if (bill.kind === "SALARY" || !bill.vendor?.trim() || tdsAmount > 0) return null;
  const s = await tdsThresholdStatus(bill.vendor, 0, paidAt);
  if (!s.crossed) return null;
  await notify({
    userIds: await adminIds(),
    kind: "TDS_THRESHOLD",
    title: `TDS threshold crossed for ${s.vendor}`,
    body: `₹${s.withThis.toLocaleString("en-IN")} paid this FY, threshold ₹${s.threshold.toLocaleString("en-IN")} — deduct TDS on payments to this payee`,
    href: "/admin/expenses",
  });
  return `Paid ₹${s.withThis.toLocaleString("en-IN")} to ${s.vendor} this FY (threshold ₹${s.threshold.toLocaleString("en-IN")}). TDS applies.`;
}

/**
 * Next DUE occurrence of a recurring bill after `afterDue`, or null when the rule ended. Created only when the bill
 * has no DUE occurrence (callers check), at the bill's current amount.
 */
export async function createNextOccurrence(tx: Tx, bill: Pick<Expense, "id" | "amount" | "plan" | "repeatRule">, afterDue: Date, tz: string): Promise<ExpenseOccurrence | null> {
  if (bill.plan !== "RECURRING") return null;
  const rule = parseRule(bill.repeatRule);
  if (!rule) return null;
  const occ = await tx.expenseOccurrence.findMany({ where: { expenseId: bill.id }, select: { seq: true, label: true } });
  const key = nextDateKey(rule, dateKey(afterDue, tz), cycleCount(occ));
  if (!key) return null;
  const seq = Math.max(0, ...occ.map((o) => o.seq)) + 1;
  return tx.expenseOccurrence.create({ data: { expenseId: bill.id, seq, amount: bill.amount, dueDate: dueFromKey(key, tz) } });
}

export type BillSaveResult = { id: string; allPaid: boolean; tdsWarning: string | null };

export async function createBillCore(input: BillInput, actorId: string, now = new Date()): Promise<BillSaveResult> {
  const tz = await companyTz();
  const category = await canonicalCategory(input.category);
  const { vendor, salaryUserId } = await resolvePayee(input);
  const occurrences = scheduleOccurrences(input, tz, now);
  const bill = await prisma.$transaction(async (tx) => {
    const e = await tx.expense.create({
      data: {
        date: occurrences[0].dueDate as Date,
        amount: D(input.amount),
        category,
        vendor,
        note: input.note,
        kind: input.kind,
        salaryUserId,
        timing: input.timing,
        plan: input.plan,
        repeatRule: ruleJson(input),
        remindDays: input.remindDays,
        vendorGstin: input.vendorGstin?.toUpperCase() ?? null,
        createdById: actorId,
        occurrences: { createMany: { data: occurrences } },
      },
    });
    await audit(actorId, "expense.create", "Expense", e.id, undefined, { ...input, vendor, category, occurrences: occurrences.length }, tx);
    return e;
  });
  const allPaid = occurrences.every((o) => o.status === "PAID");
  const tdsWarning = allPaid ? await tdsCheckAfterPayment(bill, occurrences[0].paidAt as Date, 0) : null;
  return { id: bill.id, allPaid, tdsWarning };
}

/**
 * Edit a bill. Before any payment the schedule is rebuilt from the input (like creating it again). Once something
 * is PAID the schedule is frozen: only payee / type / category / note / reminder / GSTIN and the amount change,
 * and a new amount on a recurring bill updates its DUE occurrences.
 */
export async function updateBillCore(id: string, input: BillInput, actorId: string, now = new Date()): Promise<BillSaveResult> {
  const tz = await companyTz();
  const before = await prisma.expense.findUnique({ where: { id }, include: { occurrences: { select: { id: true, status: true } } } });
  if (!before) throw new Error("Bill not found");
  const category = await canonicalCategory(input.category);
  const { vendor, salaryUserId } = await resolvePayee(input);
  const hasPaid = before.occurrences.some((o) => o.status === "PAID");
  const common = { amount: D(input.amount), category, vendor, note: input.note, kind: input.kind, salaryUserId, timing: input.timing, remindDays: input.remindDays, vendorGstin: input.vendorGstin?.toUpperCase() ?? null };
  const occurrences = hasPaid ? [] : scheduleOccurrences(input, tz, now);
  await prisma.$transaction(async (tx) => {
    if (hasPaid) {
      await tx.expense.update({ where: { id }, data: common });
      if (before.plan === "RECURRING") await tx.expenseOccurrence.updateMany({ where: { expenseId: id, status: "DUE", OR: [{ label: null }, { NOT: { label: { startsWith: BALANCE_PREFIX } } }] }, data: { amount: D(input.amount) } });
    } else {
      await tx.expenseOccurrence.deleteMany({ where: { expenseId: id } });
      await tx.expense.update({ where: { id }, data: { ...common, date: occurrences[0].dueDate as Date, plan: input.plan, repeatRule: ruleJson(input), occurrences: { createMany: { data: occurrences } } } });
    }
    await audit(actorId, "expense.update", "Expense", id, { vendor: before.vendor, amount: before.amount.toNumber(), plan: before.plan, category: before.category }, { ...input, vendor, category, scheduleFrozen: hasPaid }, tx);
  });
  const allPaid = !hasPaid && occurrences.every((o) => o.status === "PAID");
  const tdsWarning = allPaid ? await tdsCheckAfterPayment({ kind: input.kind, vendor }, occurrences[0].paidAt as Date, 0) : null;
  return { id, allPaid, tdsWarning };
}

export async function deleteBillCore(id: string, actorId: string): Promise<void> {
  const before = await prisma.expense.findUnique({ where: { id }, include: { occurrences: { select: { status: true, amount: true, billDriveId: true, itcDriveId: true } } } });
  if (!before) throw new Error("Bill not found");
  await prisma.expense.delete({ where: { id } });
  for (const o of before.occurrences) for (const fileId of [o.billDriveId, o.itcDriveId]) await trashQuietly(fileId);
  await audit(actorId, "expense.delete", "Expense", id, { vendor: before.vendor, amount: before.amount.toNumber(), category: before.category, payments: before.occurrences.filter((o) => o.status === "PAID").length }, null);
}

/** Inline "+ New" category: appended to the Settings list (kept before a trailing "Other"), deduped case-insensitively. */
export async function addExpenseCategoryCore(name: string, actorId: string): Promise<{ category: string; categories: string[] }> {
  const t = name.trim().replace(/\s+/g, " ");
  if (!t) throw new Error("Name the category");
  if (t.length > 60) throw new Error("Keep the category under 60 characters");
  const s = await prisma.companySettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  const hit = s.expenseCategories.find((c) => c.toLowerCase() === t.toLowerCase());
  if (hit) return { category: hit, categories: s.expenseCategories };
  const list = s.expenseCategories.slice();
  const otherLast = list.length > 0 && list[list.length - 1].toLowerCase() === "other";
  list.splice(otherLast ? list.length - 1 : list.length, 0, t);
  await prisma.companySettings.update({ where: { id: "default" }, data: { expenseCategories: list } });
  invalidateSettingsCache();
  await audit(actorId, "settings.expense_category_add", "CompanySettings", "default", { expenseCategories: s.expenseCategories }, { expenseCategories: list });
  return { category: t, categories: list };
}
