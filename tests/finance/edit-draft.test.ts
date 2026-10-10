import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();
type Seed = Awaited<ReturnType<typeof seedBasics>>;
let seed: Seed;
const TZ = "Asia/Kolkata";

const oneTime = (clientId: string) => ({ clientId, amount: 10000, description: "October retainer", gstPercent: 18, dueDate: "2026-11-15" });
const monthly = { frequency: "MONTHLY", interval: 1, monthAnchor: "START", notifyMinutes: 540, endDate: null };

async function actions() {
  return import("@/server/finance/invoices");
}

async function create(raw: Record<string, unknown>) {
  const res = await (await actions()).createInvoice(raw);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

describe("updateDraftInvoice (edit a draft before approving)", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "billing@repo.test", gstNumber: "27AAAAA0000A1Z5" } });
    await testDb.companySettings.update({ where: { id: "default" }, data: { gstNumber: "27ABCDE1234F1Z5", lutNumber: "AD2703" } });
    (await import("@/lib/settings")).invalidateSettingsCache();
    session.set({ id: seed.admin.id, role: "ADMIN" });
  });

  it("changes the amount, items and texts; totals recomputed; number + public token kept; audited", async () => {
    const { updateDraftInvoice } = await actions();
    const draft = await create(oneTime(seed.client.id));
    await testDb.invoice.update({ where: { id: draft.id }, data: { publicToken: "keep-me" } });
    const res = await updateDraftInvoice(draft.id, { ...oneTime(seed.client.id), amount: 25000, description: "October retainer + reels", notes: "Thanks", remindAt: "2026-11-01T04:30:00.000Z" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ id: draft.id, number: draft.number, status: "AWAITING_APPROVAL", total: 29500 });
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: draft.id }, include: { items: true } });
    expect(inv.number).toBe(`DRAFT-${draft.id}`);
    expect(inv.publicToken).toBe("keep-me");
    expect([inv.subtotal.toNumber(), inv.cgstAmount.toNumber(), inv.sgstAmount.toNumber(), inv.total.toNumber()]).toEqual([25000, 2250, 2250, 29500]);
    expect(inv.items.map((i) => [i.description, i.amount.toNumber()])).toEqual([["October retainer + reels", 25000]]);
    expect(inv).toMatchObject({ notes: "Thanks", description: "October retainer + reels" });
    expect(inv.remindAt?.toISOString()).toBe("2026-11-01T04:30:00.000Z");
    const log = await testDb.auditLog.findMany({ where: { action: "invoice.update_draft", entityId: draft.id } });
    expect(log).toHaveLength(1);
    expect(log[0].actorId).toBe(seed.admin.id);
    expect(log[0].before).toMatchObject({ total: 11800 });
    expect(log[0].after).toMatchObject({ total: 29500 });

    // line items replace the single amount
    const lines = await updateDraftInvoice(draft.id, { clientId: seed.client.id, gstPercent: 18, description: "Retainer", items: [{ description: "Reels", qty: 4, unit: "HOURS", rate: 1000 }, { description: "Logo", rate: 6000 }] });
    expect(lines.ok && lines.data.total).toBe(11800);
    expect(await testDb.invoiceItem.count({ where: { invoiceId: draft.id } })).toBe(2);
  });

  it("re-resolves tax when the client changes (CGST+SGST → IGST → export under LUT)", async () => {
    const { updateDraftInvoice } = await actions();
    const draft = await create(oneTime(seed.client.id));
    const other = await testDb.client.create({ data: { name: "Bengaluru Co", gstNumber: "29AAAAA0000A1Z5", tdsPercent: 2 } });
    const res = await updateDraftInvoice(draft.id, oneTime(other.id));
    expect(res.ok).toBe(true);
    const a = await testDb.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(a).toMatchObject({ clientId: other.id, docType: "TAX_INVOICE", taxMode: "IGST", placeOfSupply: "29 - Karnataka", tdsApplicable: true });
    expect([a.cgstAmount.toNumber(), a.igstAmount.toNumber(), a.total.toNumber()]).toEqual([0, 1800, 11800]);

    const abroad = await testDb.client.create({ data: { name: "Dubai LLC", country: "AE", currency: "AED" } });
    const exp = await updateDraftInvoice(draft.id, { ...oneTime(abroad.id), currency: null });
    expect(exp.ok).toBe(true);
    const b = await testDb.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(b).toMatchObject({ docType: "EXPORT_INVOICE", taxMode: "EXPORT_LUT", currency: "AED", tdsApplicable: false });
    expect(b.total.toNumber()).toBe(10000);
    expect(b.number).toBe(draft.number);
  });

  it("switches tax invoice ↔ proforma", async () => {
    const { updateDraftInvoice } = await actions();
    const draft = await create(oneTime(seed.client.id));
    const pro = await updateDraftInvoice(draft.id, { ...oneTime(seed.client.id), docType: "PROFORMA" });
    expect(pro.ok && pro.data.total).toBe(10000);
    expect(await testDb.invoice.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ docType: "PROFORMA", taxMode: "NONE" });
    const back = await updateDraftInvoice(draft.id, { ...oneTime(seed.client.id), docType: null });
    expect(back.ok && back.data.total).toBe(11800);
    expect(await testDb.invoice.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ docType: "TAX_INVOICE", taxMode: "CGST_SGST" });
  });

  it("recurring: a changed rule is saved and nextRunAt recomputed; one time ↔ recurring adds / drops the rule", async () => {
    const { updateDraftInvoice } = await actions();
    const { nextOccurrence } = await import("@/server/finance/recurrence");
    const draft = await create({ ...oneTime(seed.client.id), plan: "RECURRING", recurrence: monthly });
    const before = await testDb.invoice.findUniqueOrThrow({ where: { id: draft.id }, include: { schedule: true } });
    const rule = { frequency: "MONTHLY", interval: 1, monthAnchor: "DAY", dayOfMonth: 15, notifyMinutes: 600, endDate: "2027-03-31" } as const;
    const res = await updateDraftInvoice(draft.id, { ...oneTime(seed.client.id), plan: "RECURRING", recurrence: rule, remindAt: "2026-11-01T04:30:00.000Z" });
    expect(res.ok).toBe(true);
    const after = await testDb.invoice.findUniqueOrThrow({ where: { id: draft.id }, include: { schedule: true } });
    expect(after.scheduleId).toBe(before.scheduleId);
    expect(after.remindAt).toBeNull(); // recurring drafts never carry an approval reminder
    expect(after.schedule).toMatchObject({ monthAnchor: "DAY", dayOfMonth: 15, notifyMinutes: 600 });
    expect(after.schedule!.endDate?.toISOString().slice(0, 10)).toBe("2027-03-31");
    const expected = nextOccurrence(new Date(), { ...rule, endDate: null }, TZ);
    expect(after.schedule!.nextRunAt?.toISOString()).toBe(expected.toISOString());
    expect(after.schedule!.nextRunAt?.toISOString()).not.toBe(before.schedule!.nextRunAt?.toISOString());
    expect(new Date(after.schedule!.nextRunAt!).toLocaleString("en-IN", { timeZone: TZ, day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })).toMatch(/^15,? 10:00$/);

    // unchanged rule → nextRunAt untouched
    await testDb.recurrenceRule.update({ where: { id: after.scheduleId! }, data: { nextRunAt: new Date("2030-01-01T00:00:00Z") } });
    await updateDraftInvoice(draft.id, { ...oneTime(seed.client.id), amount: 12000, plan: "RECURRING", recurrence: rule });
    expect((await testDb.recurrenceRule.findUniqueOrThrow({ where: { id: after.scheduleId! } })).nextRunAt?.toISOString()).toBe("2030-01-01T00:00:00.000Z");

    // recurring → one time drops the rule; one time → recurring creates one
    const once = await updateDraftInvoice(draft.id, { ...oneTime(seed.client.id), plan: "ONE_TIME" });
    expect(once.ok).toBe(true);
    expect(await testDb.invoice.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ plan: "ONE_TIME", kind: "ONE_TIME", scheduleId: null });
    expect(await testDb.recurrenceRule.count()).toBe(0);
    const again = await updateDraftInvoice(draft.id, { ...oneTime(seed.client.id), plan: "RECURRING", recurrence: monthly });
    expect(again.ok).toBe(true);
    const re = await testDb.invoice.findUniqueOrThrow({ where: { id: draft.id }, include: { schedule: true } });
    expect(re).toMatchObject({ plan: "RECURRING", kind: "RECURRING" });
    expect(re.schedule?.nextRunAt).toBeTruthy();
  });

  it("one occurrence of a running series can't change plan", async () => {
    const { updateDraftInvoice, approveAndSend } = await actions();
    const draft = await create({ ...oneTime(seed.client.id), plan: "RECURRING", recurrence: monthly });
    await approveAndSend(draft.id, {});
    const { cloneRecurringOccurrence, loadInvoiceFull } = await import("@/server/finance/invoice-core");
    const clone = await cloneRecurringOccurrence((await loadInvoiceFull(draft.id))!, new Date(), null);
    const res = await updateDraftInvoice(clone.id, { ...oneTime(seed.client.id), plan: "ONE_TIME" });
    expect(res).toEqual({ ok: false, error: "This is one occurrence of a recurring invoice — use Stop recurrence instead of changing its plan" });
    const amount = await updateDraftInvoice(clone.id, { ...oneTime(seed.client.id), amount: 15000, plan: "RECURRING", recurrence: monthly });
    expect(amount.ok && amount.data.total).toBe(17700);
  });

  it("part payment: the issued part's amount + due date change, the plan total follows; plan / client changes are refused", async () => {
    const { updateDraftInvoice } = await actions();
    const part = await create({ clientId: seed.client.id, plan: "PART", amount: 20000, description: "Website", gstPercent: 18, parts: [{ kind: "PERCENT", value: 50, dueDate: "2026-11-01" }, { kind: "PERCENT", value: 50, dueDate: "2026-12-01" }] });
    const input = { clientId: seed.client.id, plan: "PART", amount: 12000, description: "Website build", gstPercent: 18, dueDate: "2026-11-05" };
    const res = await updateDraftInvoice(part.id, input);
    expect(res.ok && res.data.total).toBe(14160);
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: part.id }, include: { items: true } });
    expect(inv.items.map((i) => i.description)).toEqual(["Website — Part 1 of 2 (fixed)"]);
    expect(inv.dueDate?.toISOString().slice(0, 10)).toBe("2026-11-05");
    const plan = await testDb.invoicePlan.findUniqueOrThrow({ where: { id: part.planId! }, include: { parts: { orderBy: { seq: "asc" } } } });
    expect(plan.totalAmount.toNumber()).toBe(22000);
    expect(plan.parts.map((p) => [p.kind, p.amount.toNumber(), p.dueDate.toISOString().slice(0, 10)])).toEqual([
      ["FIXED", 12000, "2026-11-05"],
      ["PERCENT", 10000, "2026-12-01"],
    ]);
    expect(await updateDraftInvoice(part.id, { ...input, plan: "ONE_TIME" })).toEqual({ ok: false, error: "Part payments can't be changed to another plan here — delete the draft and create it again" });
    const other = await testDb.client.create({ data: { name: "Other" } });
    expect(await updateDraftInvoice(part.id, { ...input, clientId: other.id })).toMatchObject({ ok: false, error: expect.stringContaining("another client") });
    const draft = await create(oneTime(seed.client.id));
    expect(await updateDraftInvoice(draft.id, { ...input, parts: [{ kind: "PERCENT", value: 100, dueDate: "2026-11-01" }] })).toMatchObject({ ok: false, error: expect.stringContaining("can't be split into part payments") });
  });

  it("refuses approved, sent, cancelled documents and credit notes; non-admins are forbidden", async () => {
    const { updateDraftInvoice, approveAndSend, createCreditNote } = await actions();
    const approvedOnly = await create(oneTime(seed.client.id));
    await approveAndSend(approvedOnly.id, {}); // numbered, still AWAITING_APPROVAL, nothing sent
    const a = await updateDraftInvoice(approvedOnly.id, oneTime(seed.client.id));
    expect(a).toMatchObject({ ok: false, error: expect.stringContaining("already approved") });

    const sent = await create(oneTime(seed.client.id));
    await approveAndSend(sent.id, { email: true });
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: sent.id } })).status).toBe("SENT");
    expect(await updateDraftInvoice(sent.id, oneTime(seed.client.id))).toMatchObject({ ok: false, error: expect.stringContaining("already approved") });

    const cancelled = await create(oneTime(seed.client.id));
    await testDb.invoice.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });
    expect(await updateDraftInvoice(cancelled.id, oneTime(seed.client.id))).toMatchObject({ ok: false, error: expect.stringContaining("cancelled") });

    const cn = await createCreditNote(sent.id, { amount: 1000, reason: "Discount" });
    if (!cn.ok) throw new Error(cn.error);
    expect(await updateDraftInvoice(cn.data.id, oneTime(seed.client.id))).toMatchObject({ ok: false, error: expect.stringContaining("Credit notes") });

    const draft = await create(oneTime(seed.client.id));
    for (const role of ["EXECUTIVE", "TEAM_LEADER", "HR"] as const) {
      session.set({ id: seed.exec.id, role });
      expect(await updateDraftInvoice(draft.id, { ...oneTime(seed.client.id), amount: 1 })).toMatchObject({ ok: false });
    }
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id: draft.id } })).total.toNumber()).toBe(11800);
    expect(await testDb.auditLog.count({ where: { action: "invoice.update_draft" } })).toBe(0);
  });

  it("validates like createInvoice", async () => {
    const { updateDraftInvoice } = await actions();
    const draft = await create(oneTime(seed.client.id));
    expect(await updateDraftInvoice(draft.id, { clientId: seed.client.id, amount: 100 })).toMatchObject({ ok: false, error: expect.stringContaining("description") });
    expect(await updateDraftInvoice(draft.id, { ...oneTime(seed.client.id), plan: "RECURRING" })).toMatchObject({ ok: false, error: expect.stringContaining("recurrence") });
    expect(await updateDraftInvoice("nope", oneTime(seed.client.id))).toEqual({ ok: false, error: "Invoice not found" });
  });
});
