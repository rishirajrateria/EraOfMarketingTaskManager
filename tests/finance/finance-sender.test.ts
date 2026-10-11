import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { env } from "@/lib/env";

/** ADR 0018: finance mail goes out from GOOGLE_FINANCE_SENDER; everything else from GOOGLE_IMPERSONATE_USER. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const FINANCE = "finance@theeraofmarketing.com";
const OPS = "ops@theeraofmarketing.com";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const saved = { financeSender: env.financeSender, impersonateUser: env.impersonateUser, workspaceDomains: env.workspaceDomains };

async function mails() {
  return (await import("@/google/gmail")).sentMailDetails;
}
async function lastMail() {
  return (await mails()).at(-1)!;
}

async function sentInvoice(extra: Record<string, unknown> = {}) {
  const { createInvoice, approveAndSend } = await import("@/server/finance/invoices");
  const c = await createInvoice({ clientId: seed.client.id, items: [{ description: "Retainer", rate: 20000 }], gstPercent: 18, dueDate: day(3), ...extra });
  if (!c.ok) throw new Error(c.error);
  const s = await approveAndSend(c.data.id, { email: true });
  if (!s.ok) throw new Error(s.error);
  return c.data.id;
}

describe("finance sender (ADR 0018)", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "billing@repo.test" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
    (await mails()).length = 0;
    (await import("@/google/gmail")).sentMailLog.length = 0;
    env.financeSender = FINANCE;
    env.impersonateUser = OPS;
  });
  afterEach(() => {
    Object.assign(env, saved);
  });

  it("senderMailbox / headers: finance → finance mailbox with a company display name and Reply-To; fallback when unset", async () => {
    const { senderMailbox, senderHeaders, formatAddress } = await import("@/google/gmail");
    expect(senderMailbox("finance")).toBe(FINANCE);
    expect(senderMailbox("default")).toBe(OPS);
    expect(senderMailbox()).toBe(OPS);
    expect(await senderHeaders("finance")).toEqual({ mailbox: FINANCE, from: `"Era Of Marketing Finance" <${FINANCE}>`, replyTo: `"Era Of Marketing Finance" <${FINANCE}>` });
    expect(await senderHeaders("default")).toEqual({ mailbox: OPS, from: OPS, replyTo: null });
    env.financeSender = "";
    expect(senderMailbox("finance")).toBe(OPS);
    expect(formatAddress("a@b.com", 'Bad "Name"\r\nBcc: x@y.com')).toBe('"Bad NameBcc: x@y.com" <a@b.com>');
    expect(formatAddress("a@b.com", "एरा")).toMatch(/^=\?UTF-8\?B\?.+\?= <a@b\.com>$/);
  });

  it("tax invoice, proforma and credit note are sent from the finance mailbox", async () => {
    const { approveAndSend, createCreditNote } = await import("@/server/finance/invoices");
    const inv = await sentInvoice();
    expect(await lastMail()).toMatchObject({ sender: "finance", from: FINANCE, fromHeader: `"Era Of Marketing Finance" <${FINANCE}>`, replyTo: `"Era Of Marketing Finance" <${FINANCE}>` });
    await sentInvoice({ docType: "PROFORMA" });
    expect(await lastMail()).toMatchObject({ subject: expect.stringContaining("Proforma invoice"), sender: "finance", from: FINANCE });
    const cn = await createCreditNote(inv, { amount: 5000, reason: "Agreed discount" });
    if (!cn.ok) throw new Error(cn.error);
    expect((await approveAndSend(cn.data.id, { email: true })).ok).toBe(true);
    expect(await lastMail()).toMatchObject({ subject: expect.stringContaining("Credit note"), sender: "finance", from: FINANCE });
    const { sentMailLog } = await import("@/google/gmail");
    expect(sentMailLog.map((m) => [m.sender, m.from])).toEqual([
      ["finance", FINANCE],
      ["finance", FINANCE],
      ["finance", FINANCE],
    ]);
  });

  it("payment receipt, payment reminder and cancellation notice are sent from the finance mailbox", async () => {
    const { sendReminder, cancelInvoice } = await import("@/server/finance/invoices");
    const { recordPayment, sendReceipt } = await import("@/server/finance/payments");
    const id = await sentInvoice();
    const p = await recordPayment({ invoiceId: id, amount: 10000, method: "UPI" });
    if (!p.ok) throw new Error(p.error);
    const payment = await testDb.payment.findFirstOrThrow({ where: { invoiceId: id } });
    expect((await sendReceipt(payment.id, { email: true })).ok).toBe(true);
    expect(await lastMail()).toMatchObject({ subject: expect.stringContaining("Payment receipt"), sender: "finance", from: FINANCE });
    expect((await sendReminder(id)).ok).toBe(true);
    expect(await lastMail()).toMatchObject({ subject: expect.stringContaining("Reminder: invoice"), sender: "finance", from: FINANCE });

    const other = await sentInvoice();
    expect((await cancelInvoice(other, { reason: "Wrong amount", email: true })).ok).toBe(true);
    expect(await lastMail()).toMatchObject({ subject: expect.stringContaining("cancelled"), sender: "finance", from: FINANCE });
  });

  it("falls back to GOOGLE_IMPERSONATE_USER when GOOGLE_FINANCE_SENDER is unset", async () => {
    env.financeSender = "";
    await sentInvoice();
    expect(await lastMail()).toMatchObject({ sender: "finance", from: OPS, fromHeader: `"Era Of Marketing Finance" <${OPS}>` });
    env.impersonateUser = "";
    await sentInvoice();
    expect(await lastMail()).toMatchObject({ sender: "finance", from: "", fromHeader: "", replyTo: null });
  });

  it("non-finance mail (invites, notification emails) stays on the default sender", async () => {
    env.workspaceDomains = ["test.local"];
    const actions = await import("@/server/admin/actions");
    const res = await actions.createUser({ email: "new@test.local", name: "New", role: "HR" });
    expect(res.ok).toBe(true);
    expect(await lastMail()).toMatchObject({ to: "new@test.local", sender: "default", from: OPS, replyTo: null });

    await testDb.user.update({ where: { id: seed.exec.id }, data: { notifyByEmail: true } });
    const { sendNotificationEmails } = await import("@/lib/email");
    await sendNotificationEmails([seed.exec.id], "Task assigned", "body");
    expect(await lastMail()).toMatchObject({ to: seed.exec.email, sender: "default", from: OPS });
  });
});
