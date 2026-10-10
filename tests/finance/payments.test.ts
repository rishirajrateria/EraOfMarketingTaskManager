import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { financialYearKey } from "@/server/finance/numbering";

const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const FY = financialYearKey(new Date(), "Asia/Kolkata");
const RCP = (n: number) => `EOM-RCP/${FY}/${String(n).padStart(4, "0")}`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const input = (clientId: string, extra: Record<string, unknown> = {}) => ({ clientId, items: [{ description: "Retainer", rate: 20000 }], gstPercent: 18, description: "Retainer", dueDate: day(3), ...extra });

/** Create + approve (email) one invoice; returns its id. */
async function sentInvoice(clientId: string, extra: Record<string, unknown> = {}) {
  const { createInvoice, approveAndSend } = await import("@/server/finance/invoices");
  const c = await createInvoice(input(clientId, extra));
  if (!c.ok) throw new Error(c.error);
  const s = await approveAndSend(c.data.id, { email: true });
  if (!s.ok) throw new Error(s.error);
  return c.data.id;
}

describe("payments, receipts, hold work and the dashboard", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "billing@repo.test", whatsapp: "+919876543210" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/google/gmail")).sentMailLog.length = 0;
    (await import("@/integrations/whatsapp")).sentWhatsappLog.length = 0;
  });

  it("recordPayment: partial → PARTIALLY_PAID; TDS counts towards PAID; receipts are stored but not sent until sendReceipt", async () => {
    const { recordPayment, sendReceipt } = await import("@/server/finance/payments");
    const { sentMailLog } = await import("@/google/gmail");
    const { sentWhatsappLog } = await import("@/integrations/whatsapp");
    const id = await sentInvoice(seed.client.id);
    expect(sentMailLog).toHaveLength(1);
    const p1 = await recordPayment({ invoiceId: id, amount: 10000, method: "UPI", reference: "UTR1", notes: "first half" });
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    expect(p1.data).toMatchObject({ status: "PARTIALLY_PAID", balance: 13600, receiptNumber: RCP(1), tds: 0 });
    expect(sentMailLog).toHaveLength(1); // no automatic receipt email
    const bad = await recordPayment({ invoiceId: id, amount: 1, method: "CHEQUE" });
    expect(bad.ok).toBe(false);
    // 11600 cash + 10% TDS on the taxable 20000 (2000) = 13600 → PAID
    const p2 = await recordPayment({ invoiceId: id, amount: 11600, method: "CASH", tdsPercent: 10 });
    if (!p2.ok) throw new Error(p2.error);
    expect(p2.data).toMatchObject({ status: "PAID", balance: 0, receiptNumber: RCP(2), tds: 2000, totalReceived: 21600 });
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id }, include: { payments: { orderBy: { receivedAt: "asc" } } } });
    expect(inv.status).toBe("PAID");
    expect(inv.payments.map((p) => [p.method, p.amount.toNumber(), p.tdsAmount.toNumber(), p.tdsPercent?.toNumber() ?? null])).toEqual([
      ["UPI", 10000, 0, null],
      ["CASH", 11600, 2000, 10],
    ]);
    expect(inv.payments.every((p) => p.receiptPdfData && p.receiptPdfId && !p.receiptSentAt)).toBe(true);
    expect(await testDb.notification.count({ where: { kind: "INVOICE_PAID", invoiceId: id } })).toBe(1);
    // ADR 0017: the part payment before it was an update too — "₹10,000 received from Repo · ₹13,600 still due"
    const part = await testDb.notification.findFirstOrThrow({ where: { kind: "PAYMENT_RECEIVED" } });
    expect(part).toMatchObject({ invoiceId: id, title: "₹10,000 received from Repo · ₹13,600 still due" });
    expect((await recordPayment({ invoiceId: id, amount: 5 })).ok).toBe(false); // already paid

    const sent = await sendReceipt(inv.payments[1].id, { email: true, whatsapp: true });
    expect(sent.ok && sent.data).toMatchObject({ emailed: true, whatsapped: true, errors: [] });
    expect(sentMailLog[1].subject).toContain(RCP(2));
    expect(sentWhatsappLog).toHaveLength(1);
    expect(sentWhatsappLog[0].body).toContain("INR 11,600.00 (plus TDS INR 2,000.00)");
    expect(sentWhatsappLog[0].mediaUrl).toBeNull();
    expect((await testDb.payment.findUniqueOrThrow({ where: { id: inv.payments[1].id } })).receiptSentAt).toBeTruthy();
    expect((await sendReceipt(inv.payments[0].id, {})).ok).toBe(false);
    // an explicit TDS amount is used as given
    const other = await sentInvoice(seed.client.id);
    const p3 = await recordPayment({ invoiceId: other, amount: 23000, tdsAmount: 600, method: "BANK" });
    expect(p3.ok && p3.data).toMatchObject({ status: "PAID", tds: 600 });
  });

  it("sendReminder emails + WhatsApps the PDF with the outstanding balance", async () => {
    const { sendReminder, createInvoice } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const { sentMailLog } = await import("@/google/gmail");
    const { sentWhatsappLog } = await import("@/integrations/whatsapp");
    const id = await sentInvoice(seed.client.id);
    const draft = await createInvoice(input(seed.client.id));
    if (!draft.ok) throw new Error(draft.error);
    expect((await sendReminder(draft.data.id)).ok).toBe(false);
    await recordPayment({ invoiceId: id, amount: 10000 });
    const r = await sendReminder(id);
    expect(r.ok && r.data).toMatchObject({ reminderCount: 1, balance: 13600, emailed: true, whatsapped: true });
    expect(sentMailLog[1].subject).toContain("Reminder: invoice");
    expect(sentWhatsappLog).toHaveLength(1);
    expect(sentWhatsappLog[0].body).toContain("INR 13,600.00 outstanding");
    expect(sentWhatsappLog[0].mediaUrl).toContain("/api/public/invoice/");
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: null } });
    const r2 = await sendReminder(id);
    expect(r2.ok && r2.data).toMatchObject({ reminderCount: 2, emailed: false, whatsapped: true });
    await testDb.client.update({ where: { id: seed.client.id }, data: { whatsapp: null } });
    expect((await sendReminder(id)).ok).toBe(false);
  });

  it("holdWork pauses the client's open tasks and notifies; resumeWork restores them; paying the hold invoice resumes automatically", async () => {
    const { holdWork, resumeWork } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const id = await sentInvoice(seed.client.id);
    const end = new Date(Date.now() + 3_600_000);
    const started = await testDb.task.create({ data: { title: "Running", clientId: seed.client.id, createdById: seed.admin.id, status: "STARTED", scheduledEnd: end, assignees: { create: [{ userId: seed.exec.id }] }, sessions: { create: [{ startedAt: new Date(Date.now() - 60_000) }] } } });
    const assigned = await testDb.task.create({ data: { title: "Queued", clientId: seed.client.id, createdById: seed.admin.id, status: "ASSIGNED", assignees: { create: [{ userId: seed.tl.id }] } } });
    const done = await testDb.task.create({ data: { title: "Done", clientId: seed.client.id, createdById: seed.admin.id, status: "COMPLETED" } });
    const other = await testDb.client.create({ data: { name: "Other" } });
    const foreign = await testDb.task.create({ data: { title: "Foreign", clientId: other.id, createdById: seed.admin.id, status: "STARTED" } });

    expect((await holdWork(other.id, id)).ok).toBe(false); // invoice belongs to Repo
    const held = await holdWork(seed.client.id, id);
    expect(held.ok && held.data).toMatchObject({ paused: 2, clientName: "Repo" });
    const client = await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } });
    expect(client).toMatchObject({ workOnHold: true, holdInvoiceId: id });
    expect(client.holdSince).toBeTruthy();
    const t1 = await testDb.task.findUniqueOrThrow({ where: { id: started.id }, include: { sessions: true } });
    expect(t1).toMatchObject({ status: "PAUSED", statusBeforePause: "STARTED" });
    expect(t1.pausedAt).toBeTruthy();
    expect(t1.sessions.every((s) => s.endedAt)).toBe(true);
    expect(await testDb.task.findUniqueOrThrow({ where: { id: assigned.id } })).toMatchObject({ status: "PAUSED", statusBeforePause: "ASSIGNED" });
    expect((await testDb.task.findUniqueOrThrow({ where: { id: done.id } })).status).toBe("COMPLETED");
    expect((await testDb.task.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe("STARTED");
    const holdNotes = await testDb.notification.findMany({ where: { kind: "WORK_ON_HOLD" } });
    expect(holdNotes.map((n) => n.userId).sort()).toEqual([seed.exec.id, seed.tl.id].sort());
    expect(holdNotes[0].title).toMatch(/^Work on hold for Repo until invoice EOM\/.* is paid$/);
    const { getInvoiceDetail } = await import("@/server/finance/queries");
    expect((await getInvoiceDetail(id))?.client).toMatchObject({ workOnHold: true, holdInvoiceId: id });

    // manual resume
    const resumed = await resumeWork(seed.client.id);
    expect(resumed.ok && resumed.data.resumed).toBe(2);
    const r1 = await testDb.task.findUniqueOrThrow({ where: { id: started.id }, include: { sessions: true } });
    expect(r1).toMatchObject({ status: "STARTED", statusBeforePause: null, pausedAt: null });
    expect(r1.sessions.filter((s) => !s.endedAt)).toHaveLength(1); // a fresh session reopened
    expect(r1.scheduledEnd!.getTime()).toBeGreaterThanOrEqual(end.getTime());
    expect((await testDb.task.findUniqueOrThrow({ where: { id: assigned.id } })).status).toBe("ASSIGNED");
    expect((await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } })).workOnHold).toBe(false);
    expect((await testDb.notification.findMany({ where: { kind: "WORK_RESUMED" } })).map((n) => n.userId).sort()).toEqual([seed.exec.id, seed.tl.id].sort());
    const noop = await resumeWork(seed.client.id);
    expect(noop.ok && noop.data.resumed).toBe(0);

    // hold again, then paying in full resumes automatically
    expect((await holdWork(seed.client.id, id)).ok).toBe(true);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: started.id } })).status).toBe("PAUSED");
    const paid = await recordPayment({ invoiceId: id, amount: 23600, method: "BANK" });
    expect(paid.ok && paid.data.status).toBe("PAID");
    expect((await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } })).workOnHold).toBe(false);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: started.id } })).status).toBe("STARTED");
    expect(await testDb.notification.count({ where: { kind: "WORK_RESUMED" } })).toBe(4);
    expect(await testDb.auditLog.count({ where: { action: { in: ["client.hold_work", "client.resume_work"] } } })).toBe(4);
  });

  it("paymentsDashboard tiles, groupings and method split; clientLedger runs a statement", async () => {
    const { recordPayment } = await import("@/server/finance/payments");
    const { createInvoice } = await import("@/server/finance/invoices");
    const { paymentsDashboard, clientLedger } = await import("@/server/finance/queries");
    const soon = await sentInvoice(seed.client.id, { dueDate: day(3) });
    const late = await sentInvoice(seed.client.id, { dueDate: day(-2), items: [{ description: "Old", rate: 10000 }] });
    const far = await sentInvoice(seed.client.id, { dueDate: day(40), items: [{ description: "Far", rate: 1000 }] });
    const waiting = await createInvoice(input(seed.client.id, { items: [{ description: "Wait", rate: 500 }] }));
    if (!waiting.ok) throw new Error(waiting.error);
    await createInvoice({ ...input(seed.client.id), plan: "PART", items: [{ description: "Site", rate: 10000 }], parts: [{ kind: "PERCENT", value: 50, dueDate: day(0) }, { kind: "PERCENT", value: 50, dueDate: day(15) }] });
    await createInvoice({ ...input(seed.client.id), plan: "RECURRING", items: [{ description: "Monthly", rate: 2000 }], recurrence: { frequency: "MONTHLY", interval: 1, monthAnchor: "START" } });
    await recordPayment({ invoiceId: soon, amount: 3600, method: "UPI" });
    await recordPayment({ invoiceId: far, amount: 180, method: "CASH" });
    await recordPayment({ invoiceId: far, amount: 1000, tdsAmount: 0, method: "CASH" });

    const d = await paymentsDashboard();
    expect(d.tiles).toEqual({ outstanding: 20000 + 11800, overdue: 11800, receivedThisMonth: 4780, awaitingApproval: 5900 + 590 + 2360, awaitingApprovalCount: 3 });
    expect(d.overdue).toEqual([{ clientId: seed.client.id, clientName: "Repo", balance: 11800, invoices: [expect.objectContaining({ id: late, balance: 11800 })] }]);
    expect(d.dueSoon).toEqual([{ clientId: seed.client.id, clientName: "Repo", balance: 20000, invoices: [expect.objectContaining({ id: soon, balance: 20000, status: "PARTIALLY_PAID" })] }]);
    expect(d.outstandingByClient).toEqual([{ clientId: seed.client.id, clientName: "Repo", balance: 31800, onHold: false }]);
    expect(d.byMethod).toEqual([
      { method: "UPI", amount: 3600, count: 1 },
      { method: "CASH", amount: 1180, count: 2 },
    ]);
    expect(d.payments).toHaveLength(3);
    expect(d.upcoming.parts).toEqual([expect.objectContaining({ seq: 2, amount: 5000, title: "Site", clientName: "Repo" })]);
    expect(d.upcoming.recurrences).toEqual([expect.objectContaining({ clientName: "Repo", total: 2360 })]);
    const cash = await paymentsDashboard({ method: "CASH" });
    expect(cash.tiles.receivedThisMonth).toBe(1180);
    expect(cash.payments.every((p) => p.method === "CASH")).toBe(true);
    expect((await paymentsDashboard({ month: "2020-01" })).tiles.receivedThisMonth).toBe(0);

    const ledger = await clientLedger(seed.client.id);
    expect(ledger?.totals).toEqual({ invoiced: 23600 + 11800 + 1180, received: 4780, tds: 0, credited: 0, outstanding: 31800 });
    expect(ledger?.entries.map((e) => e.kind)).toEqual(["INVOICE", "INVOICE", "INVOICE", "PAYMENT", "PAYMENT", "PAYMENT"]);
    expect(ledger?.entries.at(-1)?.balance).toBe(31800);
    expect(await clientLedger("nope")).toBeNull();
  });
});
