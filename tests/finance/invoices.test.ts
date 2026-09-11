import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { financialYearKey } from "@/server/finance/numbering";

const session = mockSession();

type Seed = Awaited<ReturnType<typeof seedBasics>>;
let seed: Seed;

const FY = financialYearKey(new Date(), "Asia/Kolkata");
const INV = (n: number) => `EOM/${FY}/${String(n).padStart(4, "0")}`;
const RCP = (n: number) => `EOM-RCP/${FY}/${String(n).padStart(4, "0")}`;

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

  it("creates an invoice with correct subtotal / GST / total and a financial-year number", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const res = await createInvoice(baseInput(seed.client.id));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.number).toBe(INV(1));
    expect(res.data.status).toBe("DRAFT");
    expect(res.data.total).toBe(23600);
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: res.data.id }, include: { items: true } });
    expect(inv.subtotal.toNumber()).toBe(20000);
    expect(inv.gstAmount.toNumber()).toBe(3600);
    expect(inv.items).toHaveLength(2);
    expect(inv.balanceMode).toBe("MANUAL");
    expect(inv.paymentTerms).toBe("Payment due within 15 days of invoice date.");
  });

  it("advance mode collapses to a single derived line at advance %; balance mode is stored", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const res = await createInvoice({ ...baseInput(seed.client.id), paymentMode: "ADVANCE", advancePercent: 40, balanceMode: "AUTO" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: res.data.id }, include: { items: true } });
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0].description).toContain("Advance 40%");
    expect(inv.subtotal.toNumber()).toBe(8000);
    expect(inv.total.toNumber()).toBe(9440);
    expect(inv.balanceMode).toBe("AUTO");
    expect(inv.balanceDueOn).toBeNull();
    // a balance date without an explicit mode means DATE; DATE without a date is rejected
    const dated = await createInvoice({ ...baseInput(seed.client.id), paymentMode: "ADVANCE", advancePercent: 40, balanceDueOn: "2026-12-01" });
    expect(dated.ok && (await testDb.invoice.findUniqueOrThrow({ where: { id: dated.data.id } })).balanceMode).toBe("DATE");
    const bad = await createInvoice({ ...baseInput(seed.client.id), paymentMode: "ADVANCE", advancePercent: 40, balanceMode: "DATE" });
    expect(bad.ok).toBe(false);
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
    expect(sentMailLog[0].subject).toContain(INV(1));
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
    expect(p1.data.receiptNumber).toBe(RCP(1));
    const p2 = await recordPayment({ invoiceId: created.data.id, amount: 13600, method: "BANK_TRANSFER" });
    if (!p2.ok) throw new Error(p2.error);
    expect(p2.data.status).toBe("PAID");
    expect(p2.data.balance).toBe(0);
    expect(p2.data.receiptNumber).toBe(RCP(2));
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id }, include: { payments: true } });
    expect(inv.status).toBe("PAID");
    expect(inv.payments.every((p) => p.receiptPdfData && p.receiptSentAt)).toBe(true);
    expect(sentMailLog.map((m) => m.subject)).toEqual([expect.stringContaining("Invoice"), expect.stringContaining(RCP(1)), expect.stringContaining(RCP(2))]);
    expect(await testDb.notification.count({ where: { kind: "INVOICE_PAID" } })).toBe(1);
    const bad = await recordPayment({ invoiceId: created.data.id, amount: -5 });
    expect(bad.ok).toBe(false);
  });

  it("sendReminder re-emails the PDF, tracks reminderSentAt / reminderCount and audits", async () => {
    const { createInvoice, sendReminder } = await import("@/server/finance/invoices");
    const { REMINDER_TEMPLATE } = await import("@/server/finance/reminder-core");
    const { renderTemplate } = await import("@/server/finance/drive-store");
    const { sentMailLog } = await import("@/google/gmail");
    const sent = await createInvoice({ ...baseInput(seed.client.id), sendNow: true });
    const draft = await createInvoice(baseInput(seed.client.id));
    if (!sent.ok || !draft.ok) throw new Error("setup");
    expect((await sendReminder(draft.data.id)).ok).toBe(false); // drafts cannot be reminded
    const r1 = await sendReminder(sent.data.id);
    expect(r1.ok && r1.data).toMatchObject({ reminderCount: 1, balance: 23600 });
    expect(sentMailLog).toHaveLength(2);
    expect(sentMailLog[1].to).toBe("billing@repo.test");
    expect(sentMailLog[1].subject).toContain(`Reminder: invoice ${INV(1)}`);
    const r2 = await sendReminder(sent.data.id);
    expect(r2.ok && r2.data.reminderCount).toBe(2);
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: sent.data.id } });
    expect(inv.reminderCount).toBe(2);
    expect(inv.reminderSentAt!.getTime()).toBeGreaterThan(inv.sentAt!.getTime() - 1);
    expect(await testDb.auditLog.count({ where: { action: "invoice.reminder", entityId: sent.data.id } })).toBe(2);
    const text = renderTemplate(REMINDER_TEMPLATE, { client: "Repo", number: INV(1), total: "23,600.00", dueDate: "25 Sep 2026", balance: "13,600.00", company: "EOM" });
    expect(text).toContain(`Gentle reminder: invoice ${INV(1)} for INR 23,600.00 was due on 25 Sep 2026; outstanding INR 13,600.00`);
  });

  it("job: sends scheduled invoices, marks overdue, generates + sends DATE-mode balance invoices", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { run } = await import("@/jobs/invoices");
    const { sentMailLog } = await import("@/google/gmail");
    const scheduled = await createInvoice({ ...baseInput(seed.client.id), sendAt: new Date(Date.now() + 60_000).toISOString(), dueDate: "2026-01-01" });
    const advance = await createInvoice({ ...baseInput(seed.client.id), paymentMode: "ADVANCE", advancePercent: 30, balanceMode: "DATE", balanceDueOn: "2026-01-05", dueDate: "2027-01-01", sendNow: true });
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
    expect(r2).toEqual({ sent: 0, generated: 0, drafted: 0, overdue: 0 });
    expect(sentMailLog).toHaveLength(3);
  });

  it("job: AUTO balance mode drafts the balance once the client's tasks are complete, notifies admins, never sends, and is idempotent", async () => {
    const { createInvoice, sendInvoice } = await import("@/server/finance/invoices");
    const { run } = await import("@/jobs/invoices");
    const { sentMailLog } = await import("@/google/gmail");
    const advance = await createInvoice({ ...baseInput(seed.client.id), paymentMode: "ADVANCE", advancePercent: 30, balanceMode: "AUTO", dueDate: "2027-01-01", sendNow: true });
    if (!advance.ok) throw new Error(advance.error);
    const task = await testDb.task.create({ data: { title: "Reel edit", clientId: seed.client.id, createdById: seed.admin.id } });

    // an active task remains → nothing happens
    expect((await run()).drafted).toBe(0);
    expect(await testDb.invoice.count({ where: { balanceOfId: advance.data.id } })).toBe(0);

    // approved complete after the advance was raised → draft + admin notification, no email
    await testDb.task.update({ where: { id: task.id }, data: { status: "COMPLETED", approvedAt: new Date(Date.now() + 1000) } });
    const r = await run();
    expect(r).toMatchObject({ drafted: 1, sent: 0 });
    const bal = await testDb.invoice.findFirstOrThrow({ where: { balanceOfId: advance.data.id } });
    expect(bal.status).toBe("DRAFT");
    expect(bal.subtotal.toNumber()).toBe(14000);
    expect(bal.sentAt).toBeNull();
    expect(sentMailLog).toHaveLength(1); // only the advance itself
    const notes = await testDb.notification.findMany({ where: { kind: "GENERIC" } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userId: seed.admin.id, title: `Balance invoice ready to review — ${bal.number}`, href: `/admin/invoices/${bal.id}` });

    // idempotent: never a second balance for the same advance, no second notification
    expect((await run()).drafted).toBe(0);
    expect(await testDb.invoice.count({ where: { balanceOfId: advance.data.id } })).toBe(1);
    expect(await testDb.notification.count({ where: { kind: "GENERIC" } })).toBe(1);

    // Admin reviews and sends by hand
    expect((await sendInvoice(bal.id)).ok).toBe(true);
    expect(sentMailLog).toHaveLength(2);
  });

  it("job: AUTO balance is not drafted for work approved before the advance, nor while any open task remains", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { run } = await import("@/jobs/invoices");
    await testDb.task.create({ data: { title: "Old work", clientId: seed.client.id, createdById: seed.admin.id, status: "COMPLETED", approvedAt: new Date(Date.now() - 86_400_000) } });
    const advance = await createInvoice({ ...baseInput(seed.client.id), paymentMode: "ADVANCE", advancePercent: 50, balanceMode: "AUTO", sendNow: true });
    if (!advance.ok) throw new Error(advance.error);
    expect((await run()).drafted).toBe(0); // nothing approved since the advance

    const open = await testDb.task.create({ data: { title: "Still open", clientId: seed.client.id, createdById: seed.admin.id, status: "STARTED" } });
    await testDb.task.create({ data: { title: "New work", clientId: seed.client.id, createdById: seed.admin.id, status: "COMPLETED", approvedAt: new Date(Date.now() + 1000) } });
    expect((await run()).drafted).toBe(0); // one task is still active
    expect(await testDb.invoice.count({ where: { balanceOfId: advance.data.id } })).toBe(0);

    await testDb.task.update({ where: { id: open.id }, data: { deletedAt: new Date() } }); // soft-deleted tasks do not count
    expect((await run()).drafted).toBe(1);
    expect(await testDb.invoice.count({ where: { balanceOfId: advance.data.id, status: "DRAFT" } })).toBe(1);
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
    const fyRun = financialYearKey(runAt, "Asia/Kolkata");
    expect(all[1].number).toBe(fyRun === FY ? INV(2) : `EOM/${fyRun}/0001`); // a run that crosses 1 April starts the new series
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

  it("non-admins cannot create invoices or send reminders", async () => {
    const { createInvoice, sendReminder } = await import("@/server/finance/invoices");
    const sent = await createInvoice({ ...baseInput(seed.client.id), sendNow: true });
    if (!sent.ok) throw new Error(sent.error);
    session.set({ id: seed.hr.id, role: "HR" });
    const denied = await createInvoice(baseInput(seed.client.id));
    expect(denied.ok).toBe(false);
    expect(!denied.ok && denied.error).toMatch(/Admin/);
    expect((await sendReminder(sent.data.id)).ok).toBe(false);
    session.clear();
    expect((await sendReminder(sent.data.id)).ok).toBe(false);
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
