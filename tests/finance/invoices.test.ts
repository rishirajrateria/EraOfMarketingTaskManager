import { describe, it, expect, beforeEach } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { addMonths, lastDayOfMonth } from "date-fns";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { financialYearKey } from "@/server/finance/numbering";
import { reminderLog } from "@/lib/notify";

const session = mockSession();
type Seed = Awaited<ReturnType<typeof seedBasics>>;
let seed: Seed;

const TZ = "Asia/Kolkata";
const FY = financialYearKey(new Date(), TZ);
const INV = (n: number) => `EOM/${FY}/${String(n).padStart(4, "0")}`;
const PRO = (n: number) => `EOM-PRO/${FY}/${String(n).padStart(4, "0")}`;
const CN = (n: number) => `EOM-CN/${FY}/${String(n).padStart(4, "0")}`;

const baseInput = (clientId: string) => ({
  clientId,
  items: [
    { description: "Social media — Sept", hsnSac: "998371", qty: 10, unit: "HOURS", rate: 1500 },
    { description: "Logo", qty: 1, unit: "FIXED", rate: 5000 },
  ],
  gstPercent: 18,
  description: "September retainer",
  dueDate: "2026-09-25",
});

async function settings() {
  return import("@/lib/settings");
}

describe("invoicing v2", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "billing@repo.test", whatsapp: "+919876543210", address: "Pune", gstNumber: "27AAAAA0000A1Z5" } });
    await testDb.companySettings.update({ where: { id: "default" }, data: { gstNumber: "27ABCDE1234F1Z5", upiId: "eom@hdfc", lutNumber: "AD2703" } });
    (await settings()).invalidateSettingsCache();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/google/gmail")).sentMailLog.length = 0;
    (await import("@/integrations/whatsapp")).sentWhatsappLog.length = 0;
  });

  it("createInvoice: same state → CGST+SGST split, DRAFT-<id> number, AWAITING_APPROVAL, nothing sent", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { sentMailLog } = await import("@/google/gmail");
    const res = await createInvoice(baseInput(seed.client.id));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.status).toBe("AWAITING_APPROVAL");
    expect(res.data.number).toBe(`DRAFT-${res.data.id}`);
    expect(res.data.total).toBe(23600);
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: res.data.id }, include: { items: true } });
    expect(inv).toMatchObject({ docType: "TAX_INVOICE", taxMode: "CGST_SGST", placeOfSupply: "27 - Maharashtra", plan: "ONE_TIME", description: "September retainer", approvedAt: null, publicToken: null });
    expect(inv.subtotal.toNumber()).toBe(20000);
    expect(inv.cgstAmount.toNumber()).toBe(1800);
    expect(inv.sgstAmount.toNumber()).toBe(1800);
    expect(inv.igstAmount.toNumber()).toBe(0);
    expect(inv.gstAmount.toNumber()).toBe(3600);
    expect(inv.items).toHaveLength(2);
    expect(inv.paymentTerms).toBe("Payment due within 15 days of invoice date.");
    expect(sentMailLog).toHaveLength(0);
    expect(await testDb.auditLog.count({ where: { action: "invoice.create", entityId: inv.id } })).toBe(1);
    // the legacy inputs are gone
    const legacy = await createInvoice({ ...baseInput(seed.client.id), paymentMode: "ADVANCE", advancePercent: 40, sendNow: true });
    expect(legacy.ok && (await testDb.invoice.findUniqueOrThrow({ where: { id: legacy.data.id } })).status).toBe("AWAITING_APPROVAL");
    expect(await import("@/server/finance/invoices").then((m) => "sendInvoice" in m || "generateBalanceInvoice" in m || "scheduleInvoice" in m)).toBe(false);
  });

  it("other state → IGST; client abroad → export invoice at 0% under LUT; the amount + description shortcut makes one line", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    await testDb.client.update({ where: { id: seed.client.id }, data: { gstNumber: "29AAAAA0000A1Z5" } });
    const igst = await createInvoice({ clientId: seed.client.id, amount: 10000, description: "Reel edits" });
    if (!igst.ok) throw new Error(igst.error);
    const a = await testDb.invoice.findUniqueOrThrow({ where: { id: igst.data.id }, include: { items: true } });
    expect(a).toMatchObject({ docType: "TAX_INVOICE", taxMode: "IGST", placeOfSupply: "29 - Karnataka" });
    expect(a.items.map((i) => [i.description, i.amount.toNumber()])).toEqual([["Reel edits", 10000]]);
    expect([a.cgstAmount.toNumber(), a.sgstAmount.toNumber(), a.igstAmount.toNumber(), a.total.toNumber()]).toEqual([0, 0, 1800, 11800]);

    await testDb.client.update({ where: { id: seed.client.id }, data: { country: "US", gstNumber: null } });
    const exp = await createInvoice({ ...baseInput(seed.client.id), gstPercent: 18 });
    if (!exp.ok) throw new Error(exp.error);
    const b = await testDb.invoice.findUniqueOrThrow({ where: { id: exp.data.id } });
    expect(b).toMatchObject({ docType: "EXPORT_INVOICE", taxMode: "EXPORT_LUT", placeOfSupply: "Outside India (US)" });
    expect(b.gstPercent.toNumber()).toBe(0);
    expect(b.total.toNumber()).toBe(20000);
    expect((await createInvoice({ clientId: seed.client.id, amount: 100 })).ok).toBe(false); // description required with a bare amount
    expect((await createInvoice({ clientId: seed.client.id, items: [] })).ok).toBe(false);
  });

  it("approveAndSend allocates the FY number, stores the PDF, emails + WhatsApps it, rotates the public token and sets SENT", async () => {
    const { createInvoice, approveAndSend } = await import("@/server/finance/invoices");
    const { sentMailLog } = await import("@/google/gmail");
    const { sentWhatsappLog } = await import("@/integrations/whatsapp");
    const { getInvoiceDetail } = await import("@/server/finance/queries");
    const created = await createInvoice(baseInput(seed.client.id));
    if (!created.ok) throw new Error(created.error);
    const sent = await approveAndSend(created.data.id, { email: true, whatsapp: true });
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.data).toMatchObject({ number: INV(1), status: "SENT", emailed: true, whatsapped: true, errors: [] });
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(inv.status).toBe("SENT");
    expect(inv.approvedAt).toBeTruthy();
    expect(inv.approvedById).toBe(seed.admin.id);
    expect(inv.sentAt).toBeTruthy();
    expect(inv.emailSentAt).toBeTruthy();
    expect(inv.whatsappSentAt).toBeTruthy();
    expect(inv.whatsappStatus).toMatch(/^sent mock_wa_/);
    expect(inv.publicToken).toMatch(/^[a-f0-9]{64}$/);
    expect(Buffer.from(inv.pdfData!).subarray(0, 4).toString()).toBe("%PDF");
    expect(inv.pdfDriveFileId).toMatch(/^file_/);
    expect(inv.pdfBackendFileId).toMatch(/^file_/);
    expect(sentMailLog).toEqual([{ to: "billing@repo.test", subject: `Invoice ${INV(1)} from Era Of Marketing`, at: expect.any(Date) }]);
    expect(sentWhatsappLog).toHaveLength(1);
    expect(sentWhatsappLog[0].to).toBe("+919876543210");
    expect(sentWhatsappLog[0].body).toContain(`invoice ${INV(1)} for INR 23,600.00 is due on 25 Sep 2026`);
    expect(sentWhatsappLog[0].mediaUrl).toBe(`${process.env.PUBLIC_BASE_URL || process.env.AUTH_URL || ""}/api/public/invoice/${inv.publicToken}`);
    expect((await testDb.notification.findMany({ where: { kind: "INVOICE_SENT" } })).map((n) => n.userId)).toEqual([seed.admin.id]);
    expect(await testDb.auditLog.count({ where: { action: { in: ["invoice.approve", "invoice.send"] }, entityId: inv.id } })).toBe(2);

    // the public route serves the stored PDF for the token, 404 otherwise
    const { GET } = await import("@/app/api/public/invoice/[token]/route");
    const res = await GET(new Request("http://localhost/api/public/invoice/x"), { params: Promise.resolve({ token: inv.publicToken! }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const fileName = `Invoice No. ${INV(1).replace(/\//g, "-")} (Repo).pdf`; // ADR 0013
    expect(res.headers.get("Content-Disposition")).toBe(`inline; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`);
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString()).toBe("%PDF");
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ token: "0".repeat(64) }) })).status).toBe(404);
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ token: "not-a-token" }) })).status).toBe(404);

    // re-send keeps the number, rotates the token, re-emails with a custom text
    const again = await approveAndSend(created.data.id, { email: true, whatsapp: false, emailText: "Hello {{client}}, resend of {{number}}" });
    expect(again.ok && again.data.number).toBe(INV(1));
    const after = await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(after.publicToken).not.toBe(inv.publicToken);
    expect(sentMailLog).toHaveLength(2);
    expect(sentWhatsappLog).toHaveLength(1);
    const detail = await getInvoiceDetail(created.data.id);
    expect(detail).toMatchObject({ number: INV(1), status: "SENT", docType: "TAX_INVOICE", taxMode: "CGST_SGST", cgstAmount: 1800, sgstAmount: 1800, balance: 23600, client: { email: "billing@repo.test", whatsapp: "+919876543210", workOnHold: false } });
    expect(detail!.publicUrl).toContain(after.publicToken);
    expect(detail!.emailSentAt && detail!.whatsappSentAt && detail!.approvedAt).toBeTruthy();
  });

  it("approving with both channels off numbers and approves the document but it stays AWAITING_APPROVAL; a missing channel is reported", async () => {
    const { createInvoice, approveAndSend } = await import("@/server/finance/invoices");
    const { awaitingApproval } = await import("@/server/finance/queries");
    const { sentMailLog } = await import("@/google/gmail");
    const created = await createInvoice(baseInput(seed.client.id));
    if (!created.ok) throw new Error(created.error);
    expect((await awaitingApproval()).map((r) => r.id)).toEqual([created.data.id]);
    const res = await approveAndSend(created.data.id, {});
    expect(res.ok && res.data).toMatchObject({ number: INV(1), status: "AWAITING_APPROVAL", emailed: false, whatsapped: false });
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(inv.status).toBe("AWAITING_APPROVAL");
    expect(inv.approvedAt).toBeTruthy();
    expect(inv.sentAt).toBeNull();
    expect(inv.emailSentAt).toBeNull();
    expect(inv.whatsappSentAt).toBeNull();
    expect(inv.number).toBe(INV(1));
    expect(inv.pdfData).toBeTruthy();
    expect(sentMailLog).toHaveLength(0);
    expect(await awaitingApproval()).toEqual([]); // approved → no longer in the queue
    expect(await testDb.notification.count({ where: { kind: "INVOICE_SENT" } })).toBe(0);

    await testDb.client.update({ where: { id: seed.client.id }, data: { email: null } });
    const failed = await approveAndSend(created.data.id, { email: true });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error).toMatch(/approved but could not be sent: Client has no email/);
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } })).status).toBe("AWAITING_APPROVAL");
    const paid = await testDb.invoice.update({ where: { id: created.data.id }, data: { status: "PAID" } });
    expect((await approveAndSend(paid.id, { email: true })).ok).toBe(false);
  });

  it("pushForward sets remindAt; job (c) notifies admins and clears it", async () => {
    const { createInvoice, pushForward } = await import("@/server/finance/invoices");
    const { run } = await import("@/jobs/invoices");
    const created = await createInvoice(baseInput(seed.client.id));
    if (!created.ok) throw new Error(created.error);
    expect((await pushForward(created.data.id, new Date(Date.now() - 1000).toISOString())).ok).toBe(false);
    const remindAt = new Date(Date.now() + 3 * 86_400_000);
    const res = await pushForward(created.data.id, remindAt.toISOString());
    expect(res.ok && res.data.remindAt).toBe(remindAt.toISOString());
    expect((await run()).reminded).toBe(0);
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } })).remindAt).toEqual(remindAt);
    const r = await run(new Date(remindAt.getTime() + 1000));
    expect(r.reminded).toBe(1);
    // ADR 0017: an invoice to approve is a decision → push / email reminder, never a feed row
    const notes = reminderLog.filter((n) => n.kind === "INVOICE_APPROVAL_DUE");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ userIds: [seed.admin.id], href: `/admin/invoices/${created.data.id}` });
    expect(await testDb.notification.count({ where: { kind: "INVOICE_APPROVAL_DUE" } })).toBe(0);
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } })).remindAt).toBeNull();
    expect((await run(new Date(remindAt.getTime() + 2000))).reminded).toBe(0);
  });

  it("recurring with monthAnchor END → nextRunAt is the last day of next month; job (b) clones as AWAITING_APPROVAL and never sends", async () => {
    const { createInvoice, approveAndSend, stopRecurrence } = await import("@/server/finance/invoices");
    const { run } = await import("@/jobs/invoices");
    const { sentMailLog } = await import("@/google/gmail");
    const created = await createInvoice({ ...baseInput(seed.client.id), plan: "RECURRING", recurrence: { frequency: "MONTHLY", interval: 1, monthAnchor: "END" } });
    if (!created.ok) throw new Error(created.error);
    const rule = await testDb.recurrenceRule.findFirstOrThrow();
    expect(rule.monthAnchor).toBe("END");
    const expected = lastDayOfMonth(addMonths(new Date(formatInTimeZone(new Date(), TZ, "yyyy-MM-dd'T'00:00:00")), 1));
    expect(rule.notifyMinutes).toBe(540);
    expect(formatInTimeZone(rule.nextRunAt!, TZ, "yyyy-MM-dd HH:mm")).toBe(`${formatInTimeZone(expected, "UTC", "yyyy-MM-dd")} 09:00`);

    expect((await approveAndSend(created.data.id, { email: true })).ok).toBe(true);
    expect(sentMailLog).toHaveLength(1);
    const runAt = new Date(rule.nextRunAt!.getTime() + 1000);
    const r = await run(runAt);
    expect(r).toMatchObject({ cloned: 1, issued: 0 });
    const all = await testDb.invoice.findMany({ orderBy: { createdAt: "asc" } });
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ status: "AWAITING_APPROVAL", number: `DRAFT-${all[1].id}`, plan: "RECURRING", scheduleId: rule.id, approvedAt: null, taxMode: "CGST_SGST" });
    expect(all[1].total.toNumber()).toBe(23600);
    expect(sentMailLog).toHaveLength(1); // the job never sends
    expect(all[1].emailSentAt).toBeNull();
    expect(all[1].whatsappSentAt).toBeNull();
    const notes = reminderLog.filter((n) => n.kind === "INVOICE_APPROVAL_DUE");
    expect(notes.map((n) => n.href)).toEqual([`/admin/invoices/${all[1].id}`]);
    expect(await testDb.notification.count({ where: { kind: "INVOICE_APPROVAL_DUE" } })).toBe(0);
    expect(notes[0].title).toBe("Invoice for Repo is ready — approve to send");
    const after = await testDb.recurrenceRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(after.nextRunAt!.getTime()).toBeGreaterThan(runAt.getTime());
    expect(formatInTimeZone(after.nextRunAt!, TZ, "HH:mm")).toBe("09:00");
    expect(await run(runAt)).toMatchObject({ cloned: 0 });
    await stopRecurrence(created.data.id);
    expect((await run(new Date(after.nextRunAt!.getTime() + 1000))).cloned).toBe(0);
  });

  it("a recurring proforma keeps producing proformas; any one converts into a tax invoice that is approved and sent", async () => {
    const { createInvoice, approveAndSend, convertProforma } = await import("@/server/finance/invoices");
    const { run } = await import("@/jobs/invoices");
    const created = await createInvoice({ ...baseInput(seed.client.id), docType: "PROFORMA", plan: "RECURRING", recurrence: { frequency: "MONTHLY", interval: 1, monthAnchor: "END" } });
    if (!created.ok) throw new Error(created.error);
    expect((await approveAndSend(created.data.id, { email: true })).ok).toBe(true);
    const rule = await testDb.recurrenceRule.findFirstOrThrow();
    expect((await run(new Date(rule.nextRunAt!.getTime() + 1000))).cloned).toBe(1);
    const all = await testDb.invoice.findMany({ orderBy: { createdAt: "asc" } });
    expect(all.map((i) => [i.docType, i.taxMode])).toEqual([["PROFORMA", "NONE"], ["PROFORMA", "NONE"]]);
    const conv = await convertProforma(all[1].id);
    if (!conv.ok) throw new Error(conv.error);
    const tax = await testDb.invoice.findUniqueOrThrow({ where: { id: conv.data.id } });
    expect(tax).toMatchObject({ docType: "TAX_INVOICE", taxMode: "CGST_SGST", status: "AWAITING_APPROVAL", proformaOfId: all[1].id });
    const sent = await approveAndSend(tax.id, { email: true });
    expect(sent.ok).toBe(true);
    expect(await testDb.invoice.findUniqueOrThrow({ where: { id: tax.id } })).toMatchObject({ status: "SENT", number: INV(1) });
  });

  it("recurring on a chosen day (DAY anchor) at a chosen time persists dayOfMonth + notifyMinutes (ADR 0007)", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const bad = await createInvoice({ ...baseInput(seed.client.id), plan: "RECURRING", recurrence: { frequency: "MONTHLY", monthAnchor: "DAY" } });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/dayOfMonth/);
    const created = await createInvoice({ ...baseInput(seed.client.id), plan: "RECURRING", recurrence: { frequency: "MONTHLY", monthAnchor: "DAY", dayOfMonth: 15, notifyMinutes: 10 * 60 + 30 } });
    if (!created.ok) throw new Error(created.error);
    const rule = await testDb.recurrenceRule.findFirstOrThrow();
    expect(rule).toMatchObject({ monthAnchor: "DAY", dayOfMonth: 15, notifyMinutes: 630 });
    expect(formatInTimeZone(rule.nextRunAt!, TZ, "dd HH:mm")).toBe("15 10:30");
    expect(rule.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(inv.remindAt).toBeNull(); // recurring documents never take the one-off reminder
    const { getInvoiceDetail } = await import("@/server/finance/queries");
    expect((await getInvoiceDetail(created.data.id))!.schedule).toMatchObject({ monthAnchor: "DAY", dayOfMonth: 15, notifyMinutes: 630 });
  });

  it("'remind me to approve and send on' from the wizard persists remindAt; the job notifies and clears it; nothing is sent", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { run } = await import("@/jobs/invoices");
    const { sentMailLog } = await import("@/google/gmail");
    const remindAt = new Date(Date.now() + 2 * 86_400_000);
    const created = await createInvoice({ ...baseInput(seed.client.id), remindAt: remindAt.toISOString() });
    if (!created.ok) throw new Error(created.error);
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } })).remindAt).toEqual(remindAt);
    const part = await createInvoice({ ...baseInput(seed.client.id), plan: "PART", parts: [{ kind: "PERCENT", value: 50, dueDate: "2026-10-09" }, { kind: "PERCENT", value: 50, dueDate: "2026-11-09" }], remindAt: remindAt.toISOString() });
    if (!part.ok) throw new Error(part.error);
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: part.data.id } })).remindAt).toEqual(remindAt);
    expect((await run()).reminded).toBe(0);
    const r = await run(new Date(remindAt.getTime() + 1000));
    expect(r.reminded).toBe(2);
    const notes = reminderLog.filter((n) => n.kind === "INVOICE_APPROVAL_DUE");
    expect(await testDb.notification.count({ where: { kind: "INVOICE_APPROVAL_DUE" } })).toBe(0);
    expect(notes.map((n) => n.title)).toEqual(["Reminder: approve and send invoice for Repo", "Reminder: approve and send invoice for Repo"]);
    expect(notes[0].body).toMatch(/^Draft · INR/);
    const after = await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(after).toMatchObject({ remindAt: null, status: "AWAITING_APPROVAL", emailSentAt: null, whatsappSentAt: null, sentAt: null });
    expect(sentMailLog).toHaveLength(0);
  });

  it("currency: INR for Indian clients, the client's currency abroad (override allowed), copied to clones and credit notes", async () => {
    const { createInvoice, approveAndSend, createCreditNote } = await import("@/server/finance/invoices");
    const { listInvoices } = await import("@/server/finance/queries");
    const inr = await createInvoice({ ...baseInput(seed.client.id), currency: "USD" }); // ignored: Indian client
    if (!inr.ok) throw new Error(inr.error);
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: inr.data.id } })).currency).toBe("INR");

    await testDb.client.update({ where: { id: seed.client.id }, data: { country: "AE", gstNumber: null, currency: "AED" } });
    const fromClient = await createInvoice(baseInput(seed.client.id));
    if (!fromClient.ok) throw new Error(fromClient.error);
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: fromClient.data.id } })).currency).toBe("AED");
    const usd = await createInvoice({ ...baseInput(seed.client.id), currency: "usd" });
    if (!usd.ok) throw new Error(usd.error);
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: usd.data.id } })).currency).toBe("USD");
    expect((await createInvoice({ ...baseInput(seed.client.id), currency: "dollars" })).ok).toBe(false);
    expect((await listInvoices()).map((r) => r.currency).sort()).toEqual(["AED", "INR", "USD"]);

    expect((await approveAndSend(usd.data.id, {})).ok).toBe(true);
    const cn = await createCreditNote(usd.data.id, { amount: 1000, reason: "Discount" });
    if (!cn.ok) throw new Error(cn.error);
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: cn.data.id } })).currency).toBe("USD");
    const pdf = (await testDb.invoice.findUniqueOrThrow({ where: { id: usd.data.id } })).pdfData!;
    const { pdfText } = await import("../helpers/pdf-text");
    expect((await pdfText(Buffer.from(pdf))).text.replace(/\s+/g, "")).toContain("USD20,000");
  });

  it("job (d) flags overdue only for approved tax/export invoices", async () => {
    const { createInvoice, approveAndSend } = await import("@/server/finance/invoices");
    const { run } = await import("@/jobs/invoices");
    const late = await createInvoice({ ...baseInput(seed.client.id), dueDate: "2026-01-01" });
    const draft = await createInvoice({ ...baseInput(seed.client.id), dueDate: "2026-01-01" });
    const pro = await createInvoice({ ...baseInput(seed.client.id), docType: "PROFORMA", dueDate: "2026-01-01" });
    if (!late.ok || !draft.ok || !pro.ok) throw new Error("setup");
    await approveAndSend(late.data.id, { email: true });
    await approveAndSend(pro.data.id, { email: true });
    const r = await run();
    expect(r).toEqual({ issued: 0, cloned: 0, reminded: 0, overdue: 1 });
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: late.data.id } })).status).toBe("OVERDUE");
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: draft.data.id } })).status).toBe("AWAITING_APPROVAL");
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: pro.data.id } })).status).toBe("SENT");
    expect((await run()).overdue).toBe(0);
  });

  it("proforma: no tax, own series, cannot be paid, converts into a tax invoice once", async () => {
    const { createInvoice, approveAndSend, convertProforma } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const { getInvoiceDetail } = await import("@/server/finance/queries");
    const created = await createInvoice({ ...baseInput(seed.client.id), docType: "PROFORMA" });
    if (!created.ok) throw new Error(created.error);
    const pro = await testDb.invoice.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(pro).toMatchObject({ docType: "PROFORMA", taxMode: "NONE" });
    expect(pro.gstPercent.toNumber()).toBe(0);
    expect(pro.total.toNumber()).toBe(20000);
    expect((await convertProforma(pro.id)).ok).toBe(true); // conversion allowed before approval too
    await testDb.invoice.deleteMany({ where: { proformaOfId: pro.id } });
    const sent = await approveAndSend(pro.id, { email: true });
    expect(sent.ok && sent.data).toMatchObject({ number: PRO(1), status: "SENT" });
    expect((await recordPayment({ invoiceId: pro.id, amount: 100 })).ok).toBe(false);
    const conv = await convertProforma(pro.id);
    expect(conv.ok).toBe(true);
    if (!conv.ok) return;
    const tax = await testDb.invoice.findUniqueOrThrow({ where: { id: conv.data.id }, include: { items: true } });
    expect(tax).toMatchObject({ docType: "TAX_INVOICE", taxMode: "CGST_SGST", status: "AWAITING_APPROVAL", proformaOfId: pro.id, description: "September retainer" });
    expect(tax.gstPercent.toNumber()).toBe(18);
    expect(tax.total.toNumber()).toBe(23600);
    expect(tax.items).toHaveLength(2);
    expect(tax.dueDate).toEqual(pro.dueDate);
    expect((await convertProforma(pro.id)).ok).toBe(false);
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: pro.id } })).status).toBe("SENT");
    const detail = await getInvoiceDetail(pro.id);
    expect(detail?.convertedTo).toMatchObject({ id: tax.id, status: "AWAITING_APPROVAL" });
    expect((await getInvoiceDetail(tax.id))?.proformaOf).toMatchObject({ id: pro.id, number: PRO(1) });
    const approved = await approveAndSend(tax.id, { email: true });
    expect(approved.ok && approved.data.number).toBe(INV(1));
  });

  it("credit notes: partial reduces the balance, full cancels the invoice; both go through approval", async () => {
    const { createInvoice, approveAndSend, createCreditNote } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const { getInvoiceDetail } = await import("@/server/finance/queries");
    const { sentMailLog } = await import("@/google/gmail");
    const a = await createInvoice(baseInput(seed.client.id));
    if (!a.ok) throw new Error(a.error);
    expect((await createCreditNote(a.data.id, { amount: 5000, reason: "Discount" })).ok).toBe(false); // not approved yet
    await approveAndSend(a.data.id, { email: true });
    const partial = await createCreditNote(a.data.id, { amount: 5000, reason: "Agreed discount" });
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    expect(partial.data).toMatchObject({ status: "AWAITING_APPROVAL", total: 5900 });
    const cn = await testDb.invoice.findUniqueOrThrow({ where: { id: partial.data.id }, include: { items: true } });
    expect(cn).toMatchObject({ docType: "CREDIT_NOTE", taxMode: "CGST_SGST", creditNoteOfId: a.data.id, description: "Agreed discount" });
    expect([cn.subtotal.toNumber(), cn.cgstAmount.toNumber(), cn.sgstAmount.toNumber()]).toEqual([5000, 450, 450]);
    expect((await getInvoiceDetail(a.data.id))?.balance).toBe(23600); // unapproved credit note does not count yet
    const sentCn = await approveAndSend(cn.id, { email: true });
    expect(sentCn.ok && sentCn.data).toMatchObject({ number: CN(1), status: "SENT" });
    expect(sentMailLog[1].subject).toBe(`Credit note ${CN(1)} from Era Of Marketing`);
    let detail = await getInvoiceDetail(a.data.id);
    expect(detail).toMatchObject({ status: "SENT", credited: 5900, balance: 17700 });
    expect(detail?.creditNotes).toEqual([expect.objectContaining({ number: CN(1), total: 5900, status: "SENT" })]);
    expect((await createCreditNote(a.data.id, { amount: 16000, reason: "too much" })).ok).toBe(false); // only 15000 taxable left
    const pay = await recordPayment({ invoiceId: a.data.id, amount: 17700, method: "BANK" });
    expect(pay.ok && pay.data).toMatchObject({ status: "PAID", balance: 0 });
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: a.data.id } })).status).toBe("PAID");

    // full credit note → CANCELLED
    const b = await createInvoice({ clientId: seed.client.id, amount: 10000, description: "Wrong invoice" });
    if (!b.ok) throw new Error(b.error);
    await approveAndSend(b.data.id, {});
    const full = await createCreditNote(b.data.id, { reason: "Raised by mistake" });
    expect(full.ok && full.data.total).toBe(11800);
    if (!full.ok) return;
    expect((await approveAndSend(full.data.id, {})).ok).toBe(true);
    const cancelled = await testDb.invoice.findUniqueOrThrow({ where: { id: b.data.id } });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancelledAt).toBeTruthy();
    detail = await getInvoiceDetail(b.data.id);
    expect(detail).toMatchObject({ status: "CANCELLED", balance: 0, credited: 11800 });
    expect((await recordPayment({ invoiceId: b.data.id, amount: 1 })).ok).toBe(false);
    expect(await testDb.auditLog.count({ where: { action: "invoice.credit_note_apply" } })).toBe(2);
  });

  it("non-admins cannot create, approve, credit or hold; drafts can be deleted but numbered documents cannot", async () => {
    const { createInvoice, approveAndSend, createCreditNote, holdWork, deleteInvoice, sendReminder } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const created = await createInvoice(baseInput(seed.client.id));
    const draft = await createInvoice(baseInput(seed.client.id));
    if (!created.ok || !draft.ok) throw new Error("setup");
    await approveAndSend(created.data.id, { email: true });
    session.set({ id: seed.hr.id, role: "HR" });
    for (const res of [
      await createInvoice(baseInput(seed.client.id)),
      await approveAndSend(draft.data.id, { email: true }),
      await createCreditNote(created.data.id, { reason: "x" }),
      await holdWork(seed.client.id, created.data.id),
      await recordPayment({ invoiceId: created.data.id, amount: 10 }),
      await sendReminder(created.data.id),
      await deleteInvoice(draft.data.id),
    ]) {
      expect(res.ok).toBe(false);
      expect(!res.ok && res.error).toMatch(/Admin/);
    }
    session.clear();
    expect((await sendReminder(created.data.id)).ok).toBe(false);
    session.set({ id: seed.admin.id, role: "ADMIN" });
    expect((await deleteInvoice(created.data.id)).ok).toBe(false);
    expect((await deleteInvoice(draft.data.id)).ok).toBe(true);
    expect(await testDb.invoice.count()).toBe(1);
  });

  it("finance summary aggregates invoiced / received / expenses using approved invoices only", async () => {
    const { createInvoice, approveAndSend } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const { financeSummary } = await import("@/server/finance/queries");
    const c = await createInvoice(baseInput(seed.client.id));
    await createInvoice(baseInput(seed.client.id)); // never approved → not invoiced
    if (!c.ok) throw new Error(c.error);
    await approveAndSend(c.data.id, { email: true });
    await recordPayment({ invoiceId: c.data.id, amount: 3600 });
    // ADR 0009: expenses count on a paid basis (PAID occurrences); a DUE one does not
    await testDb.expense.create({ data: { date: new Date(), amount: 1000, category: "Travel", createdById: seed.admin.id, occurrences: { create: [{ seq: 1, amount: 1000, dueDate: new Date(), status: "PAID", paidAt: new Date() }, { seq: 2, amount: 1000, dueDate: new Date() }] } } });
    const s = await financeSummary();
    expect(s.totals).toEqual({ invoiced: 23600, received: 3600, outstanding: 20000, expenses: 1000, net: 2600 });
    expect(s.clients[0]).toMatchObject({ clientName: "Repo", invoiced: 23600, received: 3600, outstanding: 20000 });
    expect(s.months).toHaveLength(12);
    expect(s.months[11]).toMatchObject({ invoiced: 23600, received: 3600, expenses: 1000, net: 2600 });
  });
});
