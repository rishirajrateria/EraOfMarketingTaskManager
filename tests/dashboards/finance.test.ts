import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

/** ADR 0016: the Finance dashboard's numbers, filters and periods (proformas / credit notes never count). */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const NOW = new Date("2026-10-15T06:30:00Z"); // 15 Oct 2026, 12:00 IST
const d = (s: string) => new Date(`${s}T06:30:00Z`);

async function invoice(data: Record<string, unknown>) {
  return testDb.invoice.create({ data: { subtotal: 0, gstAmount: 0, gstPercent: 0, ...data } as never });
}

describe("finance dashboard", () => {
  let zenith: { id: string };
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
    zenith = await testDb.client.create({ data: { name: "Zenith" } });
    const repo = seed.client.id;
    // Repo: ₹1,00,000 approved 2 Oct, due 5 Oct; ₹40,000 received 6 Oct with ₹2,000 TDS → ₹58,000 overdue.
    const i1 = await invoice({ number: "EOM/26-27/0001", clientId: repo, status: "PARTIALLY_PAID", total: 100000, approvedAt: d("2026-10-02"), dueDate: d("2026-10-05") });
    await testDb.payment.create({ data: { invoiceId: i1.id, amount: 40000, tdsAmount: 2000, receivedAt: d("2026-10-06") } });
    // Zenith: ₹50,000 approved and paid in September.
    const i2 = await invoice({ number: "EOM/26-27/0002", clientId: zenith.id, status: "PAID", total: 50000, approvedAt: d("2026-09-10"), dueDate: d("2026-09-30") });
    await testDb.payment.create({ data: { invoiceId: i2.id, amount: 50000, receivedAt: d("2026-09-20") } });
    // Zenith: ₹20,000 sent 10 Oct, due next month, ₹5,000 credit note → ₹15,000 owed, not overdue.
    const i4 = await invoice({ number: "EOM/26-27/0003", clientId: zenith.id, status: "SENT", total: 20000, approvedAt: d("2026-10-10"), dueDate: d("2026-11-10") });
    await invoice({ number: "EOM-CN/26-27/0001", clientId: zenith.id, docType: "CREDIT_NOTE", status: "SENT", total: 5000, approvedAt: d("2026-10-11"), creditNoteOfId: i4.id });
    // A proforma never counts; a draft waits for approval.
    await invoice({ number: "EOM-PRO/26-27/0001", clientId: repo, docType: "PROFORMA", status: "SENT", total: 99999, approvedAt: d("2026-10-03"), dueDate: d("2026-10-04") });
    await invoice({ number: "DRAFT-a1", clientId: repo, status: "AWAITING_APPROVAL", total: 1000 });
    // Bills: rent paid 4 Oct (GST to claim, TDS), next rent overdue since 1 Oct, software paid in August.
    const rent = await testDb.expense.create({ data: { date: d("2026-10-01"), amount: 25000, category: "Rent", vendor: "Skyline Spaces", createdById: seed.admin.id } });
    await testDb.expenseOccurrence.createMany({
      data: [
        { expenseId: rent.id, seq: 1, amount: 25000, dueDate: d("2026-10-01"), status: "PAID", paidAt: d("2026-10-04"), gstAmount: 3814, itcClaimable: true, tdsAmount: 2500 },
        { expenseId: rent.id, seq: 2, amount: 25000, dueDate: d("2026-10-12"), status: "DUE" },
      ],
    });
    const sw = await testDb.expense.create({ data: { date: d("2026-08-20"), amount: 1000, category: "Software", vendor: "Figma", createdById: seed.admin.id } });
    await testDb.expenseOccurrence.create({ data: { expenseId: sw.id, seq: 1, amount: 1000, dueDate: d("2026-08-20"), status: "PAID", paidAt: d("2026-08-20") } });
  });

  it("overview, income and expense numbers for this month", async () => {
    const { financeDashboard } = await import("@/server/dashboards/finance");
    const f = await financeDashboard({ client: null, period: "MONTH" }, NOW);
    expect(f).toMatchObject({ received: 40000, invoiced: 120000, tds: 2000, outstanding: 73000, overdue: 58000, toApprove: 1 });
    expect(f).toMatchObject({ spent: 25000, net: 15000, toPay: 25000, gstToClaim: 3814, billsOverdue: 25000, tdsDeducted: 2500, billsPaid: 1 });
    expect(f.receivedByClient).toEqual([{ id: seed.client.id, label: "Repo", value: 40000 }]);
    expect(f.owed.map((b) => [b.label, b.value, b.sub])).toEqual([["Repo", 58000, "₹58,000 overdue"], ["Zenith", 15000, undefined]]);
    expect(f.byCategory).toEqual([{ id: "Rent", label: "Rent", value: 25000 }]);
    expect(f.nextBills).toEqual([expect.objectContaining({ payee: "Skyline Spaces", amount: 25000, dueKey: "2026-10-12", overdue: true })]);
    expect(f.months.map((m) => [m.short, m.income, m.expense])).toEqual([["May", 0, 0], ["Jun", 0, 0], ["Jul", 0, 0], ["Aug", 0, 1000], ["Sep", 50000, 0], ["Oct", 40000, 25000]]);
    expect(f.range.detail).toBe("Oct 2026");
  });

  it("periods: last month, 3 months, this FY", async () => {
    const { financeDashboard } = await import("@/server/dashboards/finance");
    const last = await financeDashboard({ client: null, period: "LAST" }, NOW);
    expect(last).toMatchObject({ received: 50000, invoiced: 50000, spent: 0, billsPaid: 0, gstToClaim: 0 });
    expect(last.receivedByClient.map((b) => b.label)).toEqual(["Zenith"]);
    const q = await financeDashboard({ client: null, period: "QUARTER" }, NOW);
    expect(q).toMatchObject({ received: 90000, invoiced: 170000, spent: 26000, net: 64000, billsPaid: 2 });
    expect(q.byCategory.map((b) => [b.label, b.value])).toEqual([["Rent", 25000], ["Software", 1000]]);
    const fy = await financeDashboard({ client: null, period: "FY" }, NOW);
    expect(fy).toMatchObject({ received: 90000, spent: 26000 });
    // outstanding is "now", whatever the period
    expect(last.outstanding).toBe(73000);
  });

  it("a client filter narrows income; bills are not per client", async () => {
    const { financeDashboard } = await import("@/server/dashboards/finance");
    const z = await financeDashboard({ client: zenith.id, period: "QUARTER" }, NOW);
    expect(z).toMatchObject({ received: 50000, invoiced: 70000, outstanding: 15000, overdue: 0, toApprove: 0 });
    expect(z).toMatchObject({ spent: null, net: null, toPay: null, gstToClaim: null, billsPaid: null });
    expect(z.months).toEqual([]);
    expect(z.nextBills).toEqual([]);
    const r = await financeDashboard({ client: seed.client.id, period: "MONTH" }, NOW);
    expect(r).toMatchObject({ received: 40000, outstanding: 58000, overdue: 58000, toApprove: 1 });
  });

  it("the page is Admin only", async () => {
    const page = (await import("@/app/(app)/admin/dashboards/page")).default;
    for (const u of [seed.tl, seed.exec, seed.hr]) {
      session.set({ id: u.id, role: u.role });
      await expect(page({ searchParams: Promise.resolve({}) })).rejects.toThrow(/NEXT_REDIRECT/);
    }
    session.set({ id: seed.admin.id, role: "ADMIN" });
    for (const view of ["FIN", "HR", "TASK"]) await expect(page({ searchParams: Promise.resolve({ view }) })).resolves.toBeTruthy();
  });
});
