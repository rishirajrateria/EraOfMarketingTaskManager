import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();

type Seed = Awaited<ReturnType<typeof seedBasics>>;
let seed: Seed;

const baseInput = (clientId: string) => ({
  clientId,
  items: [
    { description: "Social media — Sept", hsnSac: "998371", qty: 10, unit: "HOURS", rate: 1500 },
    { description: "Logo", qty: 1, unit: "FIXED", rate: 5000 },
  ],
  gstPercent: 18,
  dueDate: "2026-09-25",
});

describe("invoices", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "billing@repo.test", address: "Pune" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    const { sentMailLog } = await import("@/google/gmail");
    sentMailLog.length = 0;
  });

  it("creates an invoice with correct subtotal / GST / total and an allocated number", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const res = await createInvoice(baseInput(seed.client.id));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.number).toBe("EOM-INV-0001");
    expect(res.data.status).toBe("DRAFT");
    expect(res.data.total).toBe(23600);
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: res.data.id }, include: { items: true } });
    expect(inv.subtotal.toNumber()).toBe(20000);
    expect(inv.gstAmount.toNumber()).toBe(3600);
    expect(inv.items).toHaveLength(2);
    expect(inv.paymentTerms).toBe("Payment due within 15 days of invoice date.");
  });

  it("advance mode collapses to a single derived line at advance %", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const res = await createInvoice({ ...baseInput(seed.client.id), paymentMode: "ADVANCE", advancePercent: 40 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: res.data.id }, include: { items: true } });
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0].description).toContain("Advance 40%");
    expect(inv.subtotal.toNumber()).toBe(8000);
    expect(inv.total.toNumber()).toBe(9440);
  });

  it("sendInvoice sets SENT, stores the PDF and emails the client", async () => {
    const { createInvoice, sendInvoice } = await import("@/server/finance/invoices");
    const { sentMailLog } = await import("@/google/gmail");
    const created = await createInvoice(baseInput(seed.client.id));
    if (!created.ok) throw new Error(created.error);
    const sent = await sendInvoice(created.data.id);
    expect(sent).toEqual({ ok: true, data: { status: "SENT" } });
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(inv.status).toBe("SENT");
    expect(inv.sentAt).toBeTruthy();
    expect(Buffer.from(inv.pdfData!).subarray(0, 4).toString()).toBe("%PDF");
    expect(inv.pdfDriveFileId).toMatch(/^file_/);
    expect(inv.pdfBackendFileId).toMatch(/^file_/);
    expect(sentMailLog).toHaveLength(1);
    expect(sentMailLog[0].to).toBe("billing@repo.test");
    expect(sentMailLog[0].subject).toContain("EOM-INV-0001");
    const n = await testDb.notification.findMany({ where: { kind: "INVOICE_SENT" } });
    expect(n.map((x) => x.userId)).toEqual([seed.admin.id]);
    // idempotent
    await sendInvoice(created.data.id);
    expect(sentMailLog).toHaveLength(1);
  });

  it("createInvoice with sendNow sends immediately; with a future sendAt it is SCHEDULED", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const now = await createInvoice({ ...baseInput(seed.client.id), sendNow: true });
    expect(now.ok && now.data.status).toBe("SENT");
    const later = await createInvoice({ ...baseInput(seed.client.id), sendAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(later.ok && later.data.status).toBe("SCHEDULED");
  });

  it("recordPayment: partial → PARTIALLY_PAID, then full → PAID with receipt numbers and emails", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const { sentMailLog } = await import("@/google/gmail");
    const created = await createInvoice({ ...baseInput(seed.client.id), sendNow: true });
    if (!created.ok) throw new Error(created.error);
    const p1 = await recordPayment({ invoiceId: created.data.id, amount: 10000, method: "UPI", reference: "UTR1" });
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    expect(p1.data.status).toBe("PARTIALLY_PAID");
    expect(p1.data.balance).toBe(13600);
    expect(p1.data.receiptNumber).toBe("EOM-RCP-0001");
    const p2 = await recordPayment({ invoiceId: created.data.id, amount: 13600, method: "BANK_TRANSFER" });
    if (!p2.ok) throw new Error(p2.error);
    expect(p2.data.status).toBe("PAID");
    expect(p2.data.balance).toBe(0);
    expect(p2.data.receiptNumber).toBe("EOM-RCP-0002");
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id }, include: { payments: true } });
    expect(inv.status).toBe("PAID");
    expect(inv.payments.every((p) => p.receiptPdfData && p.receiptSentAt)).toBe(true);
    expect(sentMailLog.map((m) => m.subject)).toEqual([expect.stringContaining("Invoice"), expect.stringContaining("EOM-RCP-0001"), expect.stringContaining("EOM-RCP-0002")]);
    expect(await testDb.notification.count({ where: { kind: "INVOICE_PAID" } })).toBe(1);
    const bad = await recordPayment({ invoiceId: created.data.id, amount: -5 });
    expect(bad.ok).toBe(false);
  });

  it("job: sends scheduled invoices, marks overdue, generates balance invoices", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { run } = await import("@/jobs/invoices");
    const { sentMailLog } = await import("@/google/gmail");
    const scheduled = await createInvoice({ ...baseInput(seed.client.id), sendAt: new Date(Date.now() + 60_000).toISOString(), dueDate: "2026-01-01" });
    const advance = await createInvoice({ ...baseInput(seed.client.id), paymentMode: "ADVANCE", advancePercent: 30, balanceDueOn: "2026-01-05", dueDate: "2027-01-01", sendNow: true });
    if (!scheduled.ok || !advance.ok) throw new Error("setup");
    const future = new Date(Date.now() + 120_000);
    const r1 = await run(future);
    expect(r1.sent).toBe(2); // scheduled + balance invoice
    expect(r1.generated).toBe(1);
    expect(r1.overdue).toBe(1);
    const s = await testDb.invoice.findUniqueOrThrow({ where: { id: scheduled.data.id } });
    expect(s.status).toBe("OVERDUE"); // sent then immediately overdue (due date in the past)
    const bal = await testDb.invoice.findFirstOrThrow({ where: { balanceOfId: advance.data.id }, include: { items: true } });
    expect(bal.status).toBe("SENT");
    expect(bal.subtotal.toNumber()).toBe(14000); // 70% of 20000
    expect(bal.items[0].description).toContain("Balance 70%");
    expect(sentMailLog).toHaveLength(3);
    // idempotent second run
    const r2 = await run(future);
    expect(r2).toEqual({ sent: 0, generated: 0, overdue: 0 });
    expect(sentMailLog).toHaveLength(3);
  });

  it("job: recurring template spawns a new occurrence and advances nextRunAt; stopRecurrence halts it", async () => {
    const { createInvoice, stopRecurrence } = await import("@/server/finance/invoices");
    const { run } = await import("@/jobs/invoices");
    const created = await createInvoice({ ...baseInput(seed.client.id), kind: "RECURRING", recurrence: { frequency: "MONTHLY", interval: 1 }, sendNow: true, dueDate: "2026-09-25" });
    if (!created.ok) throw new Error(created.error);
    const rule = await testDb.recurrenceRule.findFirstOrThrow();
    const runAt = new Date(rule.nextRunAt!.getTime() + 1000);
    const r = await run(runAt);
    expect(r.generated).toBe(1);
    const all = await testDb.invoice.findMany({ orderBy: { createdAt: "asc" } });
    expect(all).toHaveLength(2);
    expect(all[1].number).toBe("EOM-INV-0002");
    expect(all[1].status).toBe("SENT");
    expect(all[1].scheduleId).toBe(rule.id);
    expect(all[1].total.toNumber()).toBe(23600);
    const after = await testDb.recurrenceRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(runAt.getTime());
    expect(await run(runAt)).toMatchObject({ generated: 0 });
    await stopRecurrence(created.data.id);
    const r3 = await run(new Date(after.nextRunAt!.getTime() + 1000));
    expect(r3.generated).toBe(0);
  });

  it("CA can read invoices/finance but cannot mutate", async () => {
    const ca = await testDb.user.create({ data: { email: "ca@external.test", name: "CA", role: "CA", activatedAt: new Date() } });
    const { createInvoice } = await import("@/server/finance/invoices");
    const { exportFinanceCsv } = await import("@/server/finance/finance");
    const { listInvoices } = await import("@/server/finance/queries");
    await createInvoice({ ...baseInput(seed.client.id), sendNow: true });
    session.set({ id: ca.id, role: "CA" });
    const csv = await exportFinanceCsv();
    expect(csv.ok).toBe(true);
    expect(csv.ok && csv.data).toContain("Repo");
    expect((await listInvoices())[0].total).toBe(23600);
    const denied = await createInvoice(baseInput(seed.client.id));
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.error).toMatch(/Admin/);
  });

  it("finance summary aggregates invoiced / received / expenses", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const { financeSummary } = await import("@/server/finance/queries");
    const c = await createInvoice({ ...baseInput(seed.client.id), sendNow: true });
    if (!c.ok) throw new Error(c.error);
    await recordPayment({ invoiceId: c.data.id, amount: 3600 });
    await testDb.expense.create({ data: { date: new Date(), amount: 1000, category: "Travel", createdById: seed.admin.id } });
    const s = await financeSummary();
    expect(s.totals).toEqual({ invoiced: 23600, received: 3600, outstanding: 20000, expenses: 1000, net: 2600 });
    expect(s.clients[0]).toMatchObject({ clientName: "Repo", invoiced: 23600, received: 3600, outstanding: 20000 });
    expect(s.months).toHaveLength(12);
    expect(s.months[11]).toMatchObject({ invoiced: 23600, received: 3600, expenses: 1000, net: 2600 });
  });
});
