import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import type { BillInputRaw } from "@/server/finance/schemas";

/** Payables (ADR 0009): bills with scheduled payments — one-time, parts, recurring; mark paid, balance, skip, undo. Asia/Kolkata dates. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const TZ = "Asia/Kolkata";
const key = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const bill = (over: Partial<BillInputRaw> = {}): BillInputRaw => ({ payee: "Skyline Spaces", category: "Rent", amount: 25000, plan: "ONE_TIME", dueDate: "2026-10-05", ...over });
const occs = (expenseId: string) => testDb.expenseOccurrence.findMany({ where: { expenseId }, orderBy: [{ dueDate: "asc" }, { seq: "asc" }] });

async function create(over: Partial<BillInputRaw> = {}) {
  const { createBill } = await import("@/server/finance/payables");
  const res = await createBill(bill(over));
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

async function pay(occurrenceId: string, raw: Record<string, unknown>) {
  const { markPaid } = await import("@/server/finance/payables");
  const res = await markPaid(occurrenceId, { paidOn: "2026-10-06", method: "UPI", ...raw });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

describe("payables · bills", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
  });

  it("one-time bill: due, or recorded as already paid on its (past) due day", async () => {
    const due = await create();
    expect(due.allPaid).toBe(false);
    const [o] = await occs(due.id);
    expect(o).toMatchObject({ seq: 1, status: "DUE", label: null, paidAt: null });
    expect(o.amount.toNumber()).toBe(25000);
    expect(key(o.dueDate)).toBe("2026-10-05");
    expect(o.dueDate.toISOString()).toBe("2026-10-04T18:30:00.000Z"); // start of the day in IST

    const paid = await create({ payee: "Figma", category: "Software", amount: 1800, dueDate: "2026-09-02", alreadyPaid: true, paidMethod: "CARD" });
    expect(paid.allPaid).toBe(true);
    const [p] = await occs(paid.id);
    expect(p).toMatchObject({ status: "PAID", method: "CARD" });
    expect(key(p.paidAt!)).toBe("2026-09-02");
    expect(p.notifiedAt).not.toBeNull(); // never reminded
    const row = await testDb.expense.findUniqueOrThrow({ where: { id: paid.id } });
    expect(row).toMatchObject({ vendor: "Figma", plan: "ONE_TIME", kind: "REGULAR", timing: "PREPAID", remindDays: 1 });
    expect(await testDb.auditLog.count({ where: { action: "expense.create" } })).toBe(2);
  });

  it("validates payee, amount, category list and the salary team member", async () => {
    const { createBill } = await import("@/server/finance/payables");
    expect((await createBill(bill({ payee: "" }))).ok).toBe(false);
    expect((await createBill(bill({ amount: 0 }))).ok).toBe(false);
    const cat = await createBill(bill({ category: "Snacks" }));
    expect(!cat.ok && cat.error).toMatch(/not in the expense category list/);
    expect((await createBill(bill({ category: "rent" }))).ok).toBe(true); // normalised to "Rent"
    const noUser = await createBill(bill({ kind: "SALARY", payee: "" }));
    expect(!noUser.ok && noUser.error).toMatch(/Pick the team member/);
    const admin = await createBill(bill({ kind: "SALARY", salaryUserId: seed.admin.id, category: "Salaries" }));
    expect(admin.ok).toBe(false);
    const sal = await createBill(bill({ kind: "SALARY", salaryUserId: seed.exec.id, payee: "", category: "Salaries", plan: "RECURRING", rule: { freq: "MONTHLY", monthDay: 32 } }));
    expect(sal.ok).toBe(true);
    if (sal.ok) expect(await testDb.expense.findUniqueOrThrow({ where: { id: sal.data.id } })).toMatchObject({ vendor: "Arush", kind: "SALARY", salaryUserId: seed.exec.id });
  });

  it("part payments: % parts must sum to 100, fixed parts to the total; labels and amounts", async () => {
    const { createBill } = await import("@/server/finance/payables");
    const bad = await createBill(bill({ plan: "PART", dueDate: null, partMode: "PERCENT", parts: [{ value: 40, dueDate: "2026-10-10" }, { value: 50, dueDate: "2026-11-10" }] }));
    expect(!bad.ok && bad.error).toMatch(/100%/);
    const badFixed = await createBill(bill({ plan: "PART", dueDate: null, partMode: "FIXED", amount: 10000, parts: [{ value: 4000, dueDate: "2026-10-10" }, { value: 5000, dueDate: "2026-11-10" }] }));
    expect(!badFixed.ok && badFixed.error).toMatch(/Parts must add up to ₹10,000/);

    const pct = await create({ payee: "Studio Lights", category: "Office", amount: 10000, plan: "PART", dueDate: null, partMode: "PERCENT", parts: [{ value: 33.33, dueDate: "2026-10-10", note: "Advance" }, { value: 66.67, dueDate: "2026-11-10", note: "On delivery" }] });
    const rows = await occs(pct.id);
    expect(rows.map((o) => [o.label, o.amount.toNumber(), key(o.dueDate)])).toEqual([
      ["Part 1 of 2 · Advance", 3333, "2026-10-10"],
      ["Part 2 of 2 · On delivery", 6667, "2026-11-10"], // the last part takes the rounding
    ]);
    const res = await pay(rows[0].id, { amount: 3333 });
    expect(res.message).toBe("Marked paid · next: Part 2 of 2 · On delivery ₹6,667 on 10 Nov");
    const last = await pay(rows[1].id, { amount: 6667 });
    expect(last.message).toBe("Marked paid · all parts paid");
  });

  it("recurring: paying creates the next occurrence from the rule; COUNT ends the series", async () => {
    const r = await create({ plan: "RECURRING", dueDate: "2026-10-31", amount: 25000, rule: { freq: "MONTHLY", monthDay: 32, endsType: "COUNT", endsCount: 2 } });
    const [first] = await occs(r.id);
    const stored = await testDb.expense.findUniqueOrThrow({ where: { id: r.id } });
    expect(stored.repeatRule).toMatchObject({ freq: "MONTHLY", monthDay: 32, anchorDate: "2026-10-31" });
    const a = await pay(first.id, { amount: 25000, paidOn: "2026-10-30", method: "BANK", reference: "UTR1" });
    expect(a.message).toBe("Marked paid · next ₹25,000 on 30 Nov");
    const after = await occs(r.id);
    expect(after.map((o) => [o.seq, o.status, key(o.dueDate)])).toEqual([[1, "PAID", "2026-10-31"], [2, "DUE", "2026-11-30"]]);
    expect(after[0]).toMatchObject({ method: "BANK", reference: "UTR1" });
    const b = await pay(after[1].id, { amount: 25000, paidOn: "2026-11-30" });
    expect(b.message).toBe("Marked paid"); // 2 times reached
    expect(await testDb.expenseOccurrence.count({ where: { expenseId: r.id } })).toBe(2);
  });

  it("paying less than due leaves a 'Balance of …' occurrence on the same due date", async () => {
    const r = await create({ amount: 10000 });
    const [o] = await occs(r.id);
    const res = await pay(o.id, { amount: 6000 });
    expect(res.message).toBe("Part paid · balance ₹4,000 still due");
    const rows = await occs(r.id);
    expect(rows.map((x) => [x.status, x.amount.toNumber(), x.label, key(x.dueDate)])).toEqual([
      ["PAID", 6000, null, "2026-10-05"],
      ["DUE", 4000, "Balance of payment", "2026-10-05"],
    ]);
    expect(res.balanceId).toBe(rows[1].id);
    // a recurring bill with a balance due does not get its next occurrence yet
    const rec = await create({ payee: "Cloud", category: "Software", plan: "RECURRING", amount: 1000, dueDate: "2026-10-01", rule: { freq: "MONTHLY", monthDay: 1 } });
    const [ro] = await occs(rec.id);
    await pay(ro.id, { amount: 600 });
    expect((await occs(rec.id)).map((x) => [x.status, x.amount.toNumber(), x.label])).toEqual([["PAID", 600, null], ["DUE", 400, "Balance of payment"]]);
    const [, bal] = await occs(rec.id);
    const done = await pay(bal.id, { amount: 400 });
    expect(done.message).toBe("Marked paid · next ₹1,000 on 01 Nov");
  });

  it("skip (recurring only), move the due date, undo paid", async () => {
    const { skipOccurrence, moveDueDate, undoPaid } = await import("@/server/finance/payables");
    const one = await create();
    const [oneOcc] = await occs(one.id);
    expect((await skipOccurrence(oneOcc.id)).ok).toBe(false);

    const r = await create({ plan: "RECURRING", dueDate: "2026-10-08", rule: { freq: "WEEKLY", weekdays: [4] } });
    const [o] = await occs(r.id);
    await testDb.expenseOccurrence.update({ where: { id: o.id }, data: { notifiedAt: new Date() } });
    expect((await moveDueDate(o.id, "2026-10-09")).ok).toBe(true);
    const moved = await testDb.expenseOccurrence.findUniqueOrThrow({ where: { id: o.id } });
    expect([key(moved.dueDate), moved.notifiedAt]).toEqual(["2026-10-09", null]);
    const skipped = await skipOccurrence(o.id);
    expect(skipped.ok && skipped.data.nextDue).toBeTruthy();
    const rows = await occs(r.id);
    expect(rows.map((x) => [x.status, key(x.dueDate)])).toEqual([["DUE", "2026-10-15"]]); // next Thursday after the 9th

    await pay(rows[0].id, { amount: 25000, method: "CASH", tdsPercent: 10 });
    const paid = await testDb.expenseOccurrence.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect([paid.tdsAmount.toNumber(), paid.tdsPercent?.toNumber()]).toEqual([2500, 10]);
    expect((await undoPaid(rows[0].id)).ok).toBe(true);
    const undone = await testDb.expenseOccurrence.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(undone).toMatchObject({ status: "DUE", paidAt: null, method: null, reference: null, tdsPercent: null });
    expect(undone.tdsAmount.toNumber()).toBe(0);
    expect((await undoPaid(rows[0].id)).ok).toBe(false);
  });

  it("update: schedule rebuilt before any payment; frozen after, where a new amount updates DUE occurrences", async () => {
    const { updateBill, deleteBill } = await import("@/server/finance/payables");
    const r = await create({ plan: "RECURRING", dueDate: "2026-10-01", amount: 1000, rule: { freq: "MONTHLY", monthDay: 1 } });
    const rebuilt = await updateBill(r.id, bill({ plan: "ONE_TIME", dueDate: "2026-10-20", amount: 1500, note: "changed" }));
    expect(rebuilt.ok).toBe(true);
    let rows = await occs(r.id);
    expect(rows.map((o) => [key(o.dueDate), o.amount.toNumber()])).toEqual([["2026-10-20", 1500]]);
    expect(await testDb.expense.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ plan: "ONE_TIME", repeatRule: null, note: "changed" });

    const rec = await create({ payee: "Cloud", category: "Software", plan: "RECURRING", dueDate: "2026-10-01", amount: 1000, rule: { freq: "MONTHLY", monthDay: 1 } });
    const [first] = await occs(rec.id);
    await pay(first.id, { amount: 1000 });
    const frozen = await updateBill(rec.id, bill({ payee: "Cloud Co", category: "Software", plan: "ONE_TIME", dueDate: "2027-01-01", amount: 1200 }));
    expect(frozen.ok).toBe(true);
    rows = await occs(rec.id);
    expect(rows.map((o) => [o.status, o.amount.toNumber(), key(o.dueDate)])).toEqual([["PAID", 1000, "2026-10-01"], ["DUE", 1200, "2026-11-01"]]);
    expect(await testDb.expense.findUniqueOrThrow({ where: { id: rec.id } })).toMatchObject({ plan: "RECURRING", vendor: "Cloud Co" });

    expect((await deleteBill(rec.id)).ok).toBe(true);
    expect(await testDb.expenseOccurrence.count({ where: { expenseId: rec.id } })).toBe(0);
  });

  it("inline category: appended before 'Other', deduped case-insensitively", async () => {
    const { addExpenseCategory } = await import("@/server/finance/payables");
    const a = await addExpenseCategory("  Equipment ");
    expect(a.ok && a.data.category).toBe("Equipment");
    const list = (await testDb.companySettings.findUniqueOrThrow({ where: { id: "default" } })).expenseCategories;
    expect(list.slice(-2)).toEqual(["Equipment", "Other"]);
    const again = await addExpenseCategory("equipment");
    expect(again.ok && again.data.category).toBe("Equipment");
    expect((await testDb.companySettings.findUniqueOrThrow({ where: { id: "default" } })).expenseCategories.filter((c) => c === "Equipment")).toHaveLength(1);
    expect((await create({ category: "EQUIPMENT" })).id).toBeTruthy();
  });

  it("is ADMIN only", async () => {
    const { createBill, markPaid } = await import("@/server/finance/payables");
    const r = await create();
    const [o] = await occs(r.id);
    session.set({ id: seed.hr.id, role: "HR" });
    expect((await createBill(bill())).ok).toBe(false);
    expect((await markPaid(o.id, { amount: 1, paidOn: "2026-10-06", method: "UPI" })).ok).toBe(false);
    session.clear();
    expect((await createBill(bill())).ok).toBe(false);
  });
});
