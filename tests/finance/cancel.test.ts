import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { pdfText } from "../helpers/pdf-text";
import { financialYearKey } from "@/server/finance/numbering";

/** ADR 0009: cancelling a sent invoice — number stays used, series continues, rules, parts, hold, stamped copy. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const FY = financialYearKey(new Date(), "Asia/Kolkata");
const INV = (n: number) => `EOM/${FY}/${String(n).padStart(4, "0")}`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function sent(extra: Record<string, unknown> = {}) {
  const { createInvoice, approveAndSend } = await import("@/server/finance/invoices");
  const c = await createInvoice({ clientId: seed.client.id, items: [{ description: "Retainer", rate: 10000 }], gstPercent: 18, dueDate: day(10), ...extra });
  if (!c.ok) throw new Error(c.error);
  const s = await approveAndSend(c.data.id, { email: true });
  if (!s.ok) throw new Error(s.error);
  return c.data.id;
}

describe("cancel a sent invoice", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "billing@repo.test", whatsapp: "+919876543210" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
    (await import("@/google/gmail")).sentMailDetails.length = 0;
  });

  it("keeps the number, continues the series, stamps + refiles the PDF and tells the client", async () => {
    const { cancelInvoice } = await import("@/server/finance/invoices");
    const { peekNextNumber } = await import("@/server/finance/numbering");
    const { filterRows } = await import("@/components/finance/invoice-list-helpers");
    const { listInvoices } = await import("@/server/finance/queries");
    const id = await sent();
    const before = await testDb.invoice.findUniqueOrThrow({ where: { id } });
    expect(before.number).toBe(INV(1));
    expect(await peekNextNumber()).toBe(INV(2));
    expect(await peekNextNumber()).toBe(INV(2)); // peeking never consumes

    expect((await cancelInvoice(id, { reason: "  " })).ok).toBe(false);
    const res = await cancelInvoice(id, { reason: "Wrong amount, will reissue", email: true, whatsapp: true });
    expect(res.ok && res.data).toMatchObject({ number: INV(1), nextNumber: INV(2), emailed: true, whatsapped: true, errors: [], workResumed: false });
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id } });
    expect(inv).toMatchObject({ number: INV(1), status: "CANCELLED", cancelReason: "Wrong amount, will reissue", remindAt: null });
    expect(inv.cancelledAt).not.toBeNull();
    expect(inv.monthDriveFileId).not.toBe(before.monthDriveFileId); // moved to "Cancelled invoices"
    expect((await import("@/google/drive")).trashedMockFiles).toContain(before.monthDriveFileId);
    const { text } = await pdfText(Buffer.from(inv.pdfData!));
    expect(text.replace(/\s+/g, "")).toContain("CANCELLED"); // the rotated stamp (extracted in pieces)
    expect(text).toContain("Reason: Wrong amount, will reissue");
    const mail = (await import("@/google/gmail")).sentMailDetails.at(-1)!;
    expect(mail.subject).toBe(`Invoice ${INV(1)} cancelled · Era Of Marketing`);
    expect(mail.attachments[0].filename).toMatch(/-CANCELLED\.pdf$/);
    expect(await testDb.auditLog.count({ where: { action: "invoice.cancel", entityId: id } })).toBe(1);
    expect((await cancelInvoice(id, { reason: "again" })).ok).toBe(false);

    // the next approval continues the series; the cancelled number is never reused
    const next = await sent();
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: next } })).number).toBe(INV(2));
    const rows = await listInvoices();
    expect(filterRows(rows, "all").map((r) => r.id)).toEqual([next]);
    expect(filterRows(rows, "cancelled").map((r) => r.id)).toEqual([id]);
    const { financeSummary } = await import("@/server/finance/queries");
    expect((await financeSummary()).totals).toMatchObject({ invoiced: 11800, outstanding: 11800 });
  });

  it("is blocked once money or a credit note is against the invoice, and for unsent documents", async () => {
    const { cancelInvoice, createCreditNote, createInvoice } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const paid = await sent();
    expect((await recordPayment({ invoiceId: paid, amount: 1000 })).ok).toBe(true);
    const r1 = await cancelInvoice(paid, { reason: "x" });
    expect(!r1.ok && r1.error).toBe("This invoice has payments. Use a credit note to reverse it.");

    const credited = await sent();
    expect((await createCreditNote(credited, { amount: 1000, reason: "discount" })).ok).toBe(true);
    const r2 = await cancelInvoice(credited, { reason: "x" });
    expect(!r2.ok && r2.error).toBe("This invoice has payments. Use a credit note to reverse it.");

    const draft = await createInvoice({ clientId: seed.client.id, amount: 100, description: "Draft" });
    if (!draft.ok) throw new Error(draft.error);
    const r3 = await cancelInvoice(draft.data.id, { reason: "x" });
    expect(!r3.ok && r3.error).toMatch(/delete the draft instead/);

    session.set({ id: seed.hr.id, role: "HR" });
    expect((await cancelInvoice(paid, { reason: "x" })).ok).toBe(false);
  });

  it("cancels the plan's pending parts and releases a work hold tied to the invoice", async () => {
    const { cancelInvoice, approveAndSend, createInvoice, holdWork } = await import("@/server/finance/invoices");
    const part = await createInvoice({ clientId: seed.client.id, plan: "PART", amount: 10000, description: "Site", parts: [{ kind: "PERCENT", value: 50, dueDate: day(0) }, { kind: "PERCENT", value: 50, dueDate: day(30) }] });
    if (!part.ok) throw new Error(part.error);
    expect((await approveAndSend(part.data.id, { email: true })).ok).toBe(true);
    const task = await testDb.task.create({ data: { title: "Banner", clientId: seed.client.id, createdById: seed.admin.id, status: "ASSIGNED", assignees: { create: [{ userId: seed.exec.id }] } } });
    const hold = await holdWork(seed.client.id, part.data.id);
    expect(hold.ok && hold.data.paused).toBe(1);

    const res = await cancelInvoice(part.data.id, { reason: "Project dropped" });
    expect(res.ok && res.data.workResumed).toBe(true);
    const plan = await testDb.invoicePlan.findUniqueOrThrow({ where: { id: part.data.planId! }, include: { parts: { orderBy: { seq: "asc" } } } });
    expect(plan.parts.map((p) => p.status)).toEqual(["CANCELLED", "CANCELLED"]);
    expect(plan.status).toBe("CANCELLED");
    expect(await testDb.client.findUniqueOrThrow({ where: { id: seed.client.id } })).toMatchObject({ workOnHold: false, holdInvoiceId: null });
    expect((await testDb.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe("ASSIGNED");
  });
});
