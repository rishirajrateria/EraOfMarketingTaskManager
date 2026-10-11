import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { fyRange, vendorKey } from "@/server/finance/tds";

/** TDS (ADR 0006): FY boundaries, payee threshold on expenses, per-invoice tdsApplicable, year-end summary, client PAN. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const TZ = "Asia/Kolkata";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

const todayIst = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

/** A one-time bill due on `on`, marked paid that day (ADR 0009 paid basis). */
async function paidBill(payee: string, amount: number, on: string, pay: Record<string, unknown> = {}) {
  const { createBill, markPaid } = await import("@/server/finance/payables");
  const category = payee === "Figma" ? "Software" : "Rent";
  const b = await createBill({ payee, category, amount, dueDate: on });
  if (!b.ok) throw new Error(b.error);
  const o = await testDb.expenseOccurrence.findFirstOrThrow({ where: { expenseId: b.data.id } });
  const r = await markPaid(o.id, { amount, paidOn: on, method: "UPI", ...pay });
  if (!r.ok) throw new Error(r.error);
  return { ...r.data, occurrenceId: o.id, billId: b.data.id };
}

async function dueBill(payee: string, amount: number, on: string) {
  const { createBill } = await import("@/server/finance/payables");
  const b = await createBill({ payee, category: "Rent", amount, dueDate: on });
  if (!b.ok) throw new Error(b.error);
  return b.data.id;
}

async function sentInvoice(clientId: string, extra: Record<string, unknown> = {}) {
  const { createInvoice, approveAndSend } = await import("@/server/finance/invoices");
  const c = await createInvoice({ clientId, items: [{ description: "Retainer", rate: 20000 }], gstPercent: 18, description: "Retainer", dueDate: day(3), ...extra });
  if (!c.ok) throw new Error(c.error);
  const s = await approveAndSend(c.data.id, { email: true });
  if (!s.ok) throw new Error(s.error);
  return c.data.id;
}

describe("TDS", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "billing@repo.test" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
  });

  it("fyRange: 31 March belongs to the old FY, 1 April (IST) starts the new one; vendorKey normalises", () => {
    // 2026-03-31T23:30 IST = 2026-03-31T18:00Z → FY 25-26
    const lateMarch = fyRange(new Date("2026-03-31T18:00:00Z"), TZ);
    expect(lateMarch.key).toBe("25-26");
    expect(lateMarch.start.toISOString()).toBe("2025-03-31T18:30:00.000Z"); // 1 Apr 2025 00:00 IST
    expect(lateMarch.end.toISOString()).toBe("2026-03-31T18:30:00.000Z"); // 1 Apr 2026 00:00 IST
    // 2026-04-01T00:30 IST = 2026-03-31T19:00Z → FY 26-27 even though it is still 31 March in UTC
    const earlyApril = fyRange(new Date("2026-03-31T19:00:00Z"), TZ);
    expect(earlyApril.key).toBe("26-27");
    expect(earlyApril.start.toISOString()).toBe("2026-03-31T18:30:00.000Z");
    expect(fyRange(new Date("2026-03-31T19:00:00Z"), "UTC").key).toBe("25-26");
    expect(vendorKey("  Skyline Spaces ")).toBe("skyline spaces");
    expect(vendorKey(null)).toBe("");
  });

  it("threshold (paid basis, ADR 0009): crosses exactly at the threshold, case-insensitive payees, salaries excluded, resets in the new FY", async () => {
    const { vendorTdsStatus } = await import("@/server/finance/expenses");
    const { tdsThresholdStatus, vendorFyTotal, vendorTdsSummary } = await import("@/server/finance/tds");
    const { invalidateSettingsCache } = await import("@/lib/settings");
    await testDb.companySettings.update({ where: { id: "default" }, data: { tdsThresholdAmount: 20000 } });
    invalidateSettingsCache();

    const a = await paidBill("Skyline Spaces", 12000, "2026-06-10");
    expect(a.tdsWarning).toBeNull();
    const b = await paidBill("skyline spaces", 7999.99, "2026-06-10");
    expect(b.tdsWarning).toBeNull();
    // a DUE (unpaid) bill does not count
    await dueBill("Skyline Spaces", 50000, "2026-06-12");
    // a salary bill to someone with the same name does not count either
    const { createBill, markPaid } = await import("@/server/finance/payables");
    await testDb.user.update({ where: { id: seed.exec.id }, data: { name: "Skyline Spaces" } });
    const sal = await createBill({ kind: "SALARY", salaryUserId: seed.exec.id, category: "Salaries", amount: 90000, dueDate: "2026-06-10", alreadyPaid: true });
    expect(sal.ok && sal.data.tdsWarning).toBeNull();
    expect(await vendorFyTotal("SKYLINE SPACES", new Date("2026-06-10"))).toBe(19999.99);
    expect(await testDb.notification.count({ where: { kind: "TDS_THRESHOLD" } })).toBe(0);

    // exactly reaching the threshold counts as crossed
    const live = await vendorTdsStatus("Skyline Spaces", 0.01, "2026-06-11");
    expect(live.ok && live.data).toMatchObject({ paidSoFar: 19999.99, withThis: 20000, threshold: 20000, crossed: true, alreadyCrossed: false, fyKey: "26-27" });
    const c = await paidBill("Skyline Spaces", 0.01, "2026-06-11");
    expect(c.tdsWarning).toMatch(/Paid ₹20,000 to Skyline Spaces this FY \(threshold ₹20,000\)\. TDS applies\./);
    const notes = await testDb.notification.findMany({ where: { kind: "TDS_THRESHOLD" } });
    expect(notes).toHaveLength(1); // one admin in the seed
    expect(notes[0]).toMatchObject({ userId: seed.admin.id, title: "TDS threshold crossed for Skyline Spaces", href: "/admin/expenses" });
    expect(notes[0].body).toMatch(/₹20,000 paid this FY, threshold ₹20,000/);

    // already over: no notification when TDS is deducted on the payment
    const status = await tdsThresholdStatus("skyline SPACES", 5000, new Date("2026-07-01"));
    expect(status).toMatchObject({ paidSoFar: 20000, withThis: 25000, crossed: true, alreadyCrossed: true });
    const d = await paidBill("Skyline Spaces", 5000, "2026-07-01", { tdsPercent: 10 });
    expect(d.tdsWarning).toBeNull();
    expect(await testDb.notification.count({ where: { kind: "TDS_THRESHOLD" } })).toBe(1);
    const row = await testDb.expenseOccurrence.findUniqueOrThrow({ where: { id: d.occurrenceId } });
    expect([row.tdsPercent?.toNumber(), row.tdsAmount.toNumber(), row.amount.toNumber()]).toEqual([10, 500, 5000]);
    // excluding a payment from "paid so far" (live check in the mark-paid sheet)
    expect((await tdsThresholdStatus("Skyline Spaces", 0, new Date("2026-07-01"), d.occurrenceId)).paidSoFar).toBe(20000);
    expect((await markPaid(d.occurrenceId, { amount: 1, paidOn: "2026-07-01", method: "UPI" })).ok).toBe(false); // already paid
    const over = await createBill({ payee: "X", category: "Rent", amount: 100, dueDate: "2026-07-01" });
    if (!over.ok) throw new Error(over.error);
    const xo = await testDb.expenseOccurrence.findFirstOrThrow({ where: { expenseId: over.data.id } });
    expect((await markPaid(xo.id, { amount: 100, paidOn: "2026-07-01", method: "UPI", tdsAmount: 200 })).ok).toBe(false); // TDS > payment

    // a new financial year starts from zero (31 Mar vs 1 Apr, by paid date)
    expect(await vendorFyTotal("Skyline Spaces", new Date("2027-03-31T12:00:00Z"))).toBe(25000);
    expect(await vendorFyTotal("Skyline Spaces", new Date("2027-04-01T12:00:00Z"))).toBe(0);
    const next = await tdsThresholdStatus("Skyline Spaces", 1000, new Date("2027-04-05"));
    expect(next).toMatchObject({ paidSoFar: 0, withThis: 1000, crossed: false, alreadyCrossed: false, fyKey: "27-28" });
    expect((await tdsThresholdStatus("Figma", 1800, new Date("2026-06-20"))).crossed).toBe(false);

    const summary = await vendorTdsSummary(new Date("2026-09-01"));
    expect(summary).toMatchObject({ fyKey: "26-27", threshold: 20000 });
    expect(summary.vendors).toEqual([{ vendor: "Skyline Spaces", paid: 25000, tds: 500, expenses: 4, crossed: true }]);
  });

  it("expense CSV export lists paid payments with TDS and GST columns", async () => {
    const { exportExpensesCsv } = await import("@/server/finance/expenses");
    await paidBill("Figma", 1000, "2026-05-05", { tdsPercent: 2, gst: { includesGst: true, gstRate: 18, itcClaimable: true } });
    await dueBill("Unpaid Co", 999, "2026-05-06");
    const csv = await exportExpensesCsv({ month: "2026-05" });
    expect(csv.ok && csv.data).toContain("paidOn,payee,category,type,label,amount,tdsPercent,tdsAmount,netPaid,method,reference,gstRate,gstAmount,vendorGstin,gstClaimable");
    expect(csv.ok && csv.data).toContain("2026-05-05,Figma,Software,regular,,1000.00,2,20.00,980.00,UPI,,18,152.54,,yes");
    expect(csv.ok && csv.data).not.toContain("Unpaid Co");
    expect(csv.ok && csv.data).toContain("TOTAL TDS,20.00");
    expect(csv.ok && csv.data).toContain("GST CLAIMABLE,152.54");
  });

  it("invoice tdsApplicable defaults from the client, can be overridden, and is flipped by a TDS payment", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const { getInvoiceDetail } = await import("@/server/finance/queries");
    const flag = async (id: string) => (await testDb.invoice.findUniqueOrThrow({ where: { id } })).tdsApplicable;

    const noPct = await createInvoice({ clientId: seed.client.id, amount: 1000, description: "A" });
    expect(noPct.ok && (await flag(noPct.data.id))).toBe(false);
    const forced = await createInvoice({ clientId: seed.client.id, amount: 1000, description: "B", tdsApplicable: true });
    expect(forced.ok && (await flag(forced.data.id))).toBe(true);

    await testDb.client.update({ where: { id: seed.client.id }, data: { tdsPercent: 10 } });
    const withPct = await createInvoice({ clientId: seed.client.id, amount: 1000, description: "C" });
    expect(withPct.ok && (await flag(withPct.data.id))).toBe(true);
    const optOut = await createInvoice({ clientId: seed.client.id, amount: 1000, description: "D", tdsApplicable: false });
    expect(optOut.ok && (await flag(optOut.data.id))).toBe(false);
    // parts inherit the choice
    const part = await createInvoice({ clientId: seed.client.id, plan: "PART", amount: 10000, description: "Site", tdsApplicable: false, parts: [{ kind: "PERCENT", value: 50, dueDate: day(0) }, { kind: "PERCENT", value: 50, dueDate: day(15) }] });
    expect(part.ok && (await flag(part.data.id))).toBe(false);

    const id = await sentInvoice(seed.client.id, { tdsApplicable: false });
    const detail = await getInvoiceDetail(id);
    expect(detail).toMatchObject({ tdsApplicable: false, client: { tdsPercent: 10 } });
    const p1 = await recordPayment({ invoiceId: id, amount: 5000, method: "BANK" });
    expect(p1.ok).toBe(true);
    expect(await flag(id)).toBe(false); // no TDS → flag untouched
    const p2 = await recordPayment({ invoiceId: id, amount: 16600, method: "BANK", tdsPercent: 10 });
    expect(p2.ok && p2.data).toMatchObject({ status: "PAID", tds: 2000 });
    expect(await flag(id)).toBe(true); // TDS recorded → flipped for the year-end total
    expect((await getInvoiceDetail(id))?.tdsApplicable).toBe(true);
  });

  it("tdsSummary: receivable per client and on expenses for the FY; previous FY is separate", async () => {
    const { recordPayment } = await import("@/server/finance/payments");
    const { tdsSummary } = await import("@/server/finance/tds");
    const other = await testDb.client.create({ data: { name: "Other", email: "o@test.local" } });
    const a = await sentInvoice(seed.client.id);
    const b = await sentInvoice(other.id, { items: [{ description: "Ads", rate: 10000 }] });
    expect((await recordPayment({ invoiceId: a, amount: 10000, tdsPercent: 10, receivedAt: today() })).ok).toBe(true);
    expect((await recordPayment({ invoiceId: a, amount: 1000, tdsAmount: 150, receivedAt: today() })).ok).toBe(true);
    expect((await recordPayment({ invoiceId: b, amount: 5000, tdsAmount: 200, receivedAt: today() })).ok).toBe(true);
    // a payment from a previous FY must not count
    const lastYear = new Date(fyRange(new Date(), TZ).start.getTime() - 86_400_000);
    await testDb.payment.create({ data: { invoiceId: b, amount: 100, tdsAmount: 999, receivedAt: lastYear, receiptNumber: "OLD-1" } });
    await paidBill("Skyline Spaces", 25000, todayIst(), { tdsPercent: 10 });
    await paidBill("Stationery Hub", 1000, todayIst());

    const s = await tdsSummary();
    expect(s).toMatchObject({ fyKey: fyRange(new Date(), TZ).key, receivable: 2350, onExpenses: 2500 });
    expect(s.byClient).toEqual([
      { clientId: seed.client.id, clientName: "Repo", tds: 2150, payments: 2 },
      { clientId: other.id, clientName: "Other", tds: 200, payments: 1 },
    ]);
    const prev = await tdsSummary(lastYear);
    expect(prev).toMatchObject({ receivable: 999, onExpenses: 0 });
    expect(prev.byClient).toEqual([{ clientId: other.id, clientName: "Other", tds: 999, payments: 1 }]);
  });

  it("client PAN is validated and upper-cased; business name is stored and printed on the invoice", async () => {
    const { createClient, updateClient } = await import("@/server/admin/actions");
    const bad = await createClient({ name: "Bad PAN", pan: "ABC1234" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/PAN/);
    expect((await createClient({ name: "Bad PAN 2", pan: "ABCDE12345" })).ok).toBe(false);
    const ok = await createClient({ name: "Acme", businessName: "Acme Industries Pvt Ltd", pan: " abcde1234f " });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const row = await testDb.client.findUniqueOrThrow({ where: { id: ok.data.id } });
    expect(row).toMatchObject({ pan: "ABCDE1234F", businessName: "Acme Industries Pvt Ltd" });
    const cleared = await updateClient({ id: ok.data.id, name: "Acme", pan: "", businessName: "" });
    expect(cleared.ok).toBe(true);
    expect(await testDb.client.findUniqueOrThrow({ where: { id: ok.data.id } })).toMatchObject({ pan: null, businessName: null });
    const { listClients } = await import("@/server/admin/queries");
    expect((await listClients()).find((c) => c.name === "Acme")).toMatchObject({ pan: null, businessName: null });

    // the PDF bill-to block uses the business name and prints the PAN
    const { renderInvoicePdf } = await import("@/server/finance/pdf");
    const pdf = await renderInvoicePdf(
      { number: "EOM/26-27/0001", issuedAt: new Date(), items: [{ description: "Work", qty: 1, unit: "FIXED", rate: 100, amount: 100 }], subtotal: 100, gstPercent: 18, gstAmount: 18, total: 118 },
      { name: "Acme", businessName: "Acme Industries Pvt Ltd", pan: "ABCDE1234F" },
      { companyName: "EOM", address: "", gstNumber: "", bankName: "", bankAccountName: "", bankAccountNumber: "", bankIfsc: "", upiId: "" },
    );
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
