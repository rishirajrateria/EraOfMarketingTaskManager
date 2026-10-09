import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { financialYearKey } from "@/server/finance/numbering";

const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const FY = financialYearKey(new Date(), "Asia/Kolkata");
const INV = (n: number) => `EOM/${FY}/${String(n).padStart(4, "0")}`;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const partInput = (clientId: string) => ({
  clientId,
  plan: "PART",
  items: [{ description: "Website build", qty: 1, unit: "FIXED", rate: 20000 }],
  gstPercent: 18,
  description: "Website in three milestones",
  parts: [
    { kind: "PERCENT", value: 50, dueDate: day(0), description: "Advance" },
    { kind: "PERCENT", value: 30, dueDate: day(30), description: "Design sign-off" },
    { kind: "PERCENT", value: 20, dueDate: day(60), description: "Go-live" },
  ],
});

describe("part-payment plans", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "billing@repo.test" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/google/gmail")).sentMailLog.length = 0;
  });

  it("createInvoice PART creates the plan + parts and issues part 1 as AWAITING_APPROVAL; mismatched sums are rejected", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { getInvoiceDetail } = await import("@/server/finance/queries");
    const bad = await createInvoice({ ...partInput(seed.client.id), parts: partInput(seed.client.id).parts.map((p, i) => (i === 2 ? { ...p, value: 10 } : p)) });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/add up to 18000 but must equal 20000/);
    expect(await testDb.invoicePlan.count()).toBe(0);

    const res = await createInvoice(partInput(seed.client.id));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.status).toBe("AWAITING_APPROVAL");
    expect(res.data.total).toBe(11800);
    const plan = await testDb.invoicePlan.findUniqueOrThrow({ where: { id: res.data.planId! }, include: { parts: { orderBy: { seq: "asc" } } } });
    expect(plan).toMatchObject({ clientId: seed.client.id, title: "Website build", status: "ACTIVE", createdById: seed.admin.id });
    expect(plan.totalAmount.toNumber()).toBe(20000);
    expect(plan.parts.map((p) => [p.seq, p.amount.toNumber(), p.status, p.invoiceId])).toEqual([
      [1, 10000, "ISSUED", res.data.id],
      [2, 6000, "PENDING", null],
      [3, 4000, "PENDING", null],
    ]);
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: res.data.id }, include: { items: true } });
    expect(inv).toMatchObject({ plan: "PART", planId: plan.id, partSeq: 1, taxMode: "CGST_SGST", number: `DRAFT-${inv.id}` });
    expect(inv.items[0].description).toBe("Advance — Part 1 of 3 (50%)");
    expect(inv.subtotal.toNumber()).toBe(10000);
    const detail = await getInvoiceDetail(inv.id);
    expect(detail?.planRef?.parts.map((p) => [p.seq, p.status, p.invoice?.id ?? null])).toEqual([
      [1, "ISSUED", inv.id],
      [2, "PENDING", null],
      [3, "PENDING", null],
    ]);
    // fixed parts work too and the plan inherits the GST percent at issue time
    const fixed = await createInvoice({ ...partInput(seed.client.id), gstPercent: 5, parts: [{ kind: "FIXED", value: 15000, dueDate: day(0) }, { kind: "FIXED", value: 5000, dueDate: day(10) }] });
    expect(fixed.ok && fixed.data.total).toBe(15750);
  });

  it("issuePart early, mergeRemainingParts, updatePartSchedule; job (a) issues due parts and notifies; plan completes when all parts are paid", async () => {
    const { createInvoice, approveAndSend, issuePart, mergeRemainingParts, updatePartSchedule } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const { run } = await import("@/jobs/invoices");
    const { sentMailLog } = await import("@/google/gmail");
    const first = await createInvoice(partInput(seed.client.id));
    if (!first.ok) throw new Error(first.error);
    const planId = first.data.planId!;

    // re-schedule the pending parts (must still sum to the remaining 10000)
    expect((await updatePartSchedule(planId, [{ kind: "FIXED", value: 7000, dueDate: day(20) }])).ok).toBe(false);
    const upd = await updatePartSchedule(planId, [
      { kind: "PERCENT", value: 25, dueDate: day(20), description: "Half" },
      { kind: "FIXED", value: 5000, dueDate: day(40), description: "Rest" },
    ]);
    expect(upd.ok && upd.data.parts.map((p) => [p.seq, p.amount, p.status])).toEqual([
      [1, 10000, "ISSUED"],
      [4, 5000, "PENDING"],
      [5, 5000, "PENDING"],
    ]);

    // job (a): part 4 becomes due → issued + admins notified, never sent
    expect((await run()).issued).toBe(0);
    const r = await run(new Date(Date.now() + 21 * 86_400_000));
    expect(r.issued).toBe(1);
    const p4 = await testDb.invoicePart.findUniqueOrThrow({ where: { planId_seq: { planId, seq: 4 } } });
    expect(p4.status).toBe("ISSUED");
    const inv4 = await testDb.invoice.findUniqueOrThrow({ where: { id: p4.invoiceId! } });
    expect(inv4).toMatchObject({ status: "AWAITING_APPROVAL", partSeq: 4, planId });
    expect(inv4.total.toNumber()).toBe(5900);
    expect(sentMailLog).toHaveLength(0);
    expect((await testDb.notification.findMany({ where: { kind: "INVOICE_APPROVAL_DUE" } }))[0]).toMatchObject({ userId: seed.admin.id, href: `/admin/invoices/${inv4.id}` });
    expect((await run(new Date(Date.now() + 21 * 86_400_000))).issued).toBe(0); // idempotent

    // issue part 5 early, then nothing is left to merge
    const early = await issuePart(planId, 5);
    expect(early.ok && early.data).toMatchObject({ status: "AWAITING_APPROVAL", seq: 5 });
    const twice = await issuePart(planId, 5);
    expect(twice.ok && twice.data.id).toBe(early.ok ? early.data.id : ""); // idempotent
    expect((await mergeRemainingParts(planId, { dueDate: day(5) })).ok).toBe(false);

    // pay everything → part statuses PAID, plan COMPLETED
    for (const id of [first.data.id, inv4.id, early.ok ? early.data.id : ""]) {
      const sent = await approveAndSend(id, { email: true });
      if (!sent.ok) throw new Error(sent.error);
      const inv = await testDb.invoice.findUniqueOrThrow({ where: { id } });
      const paid = await recordPayment({ invoiceId: id, amount: inv.total.toNumber(), method: "UPI" });
      expect(paid.ok && paid.data.status).toBe("PAID");
    }
    const plan = await testDb.invoicePlan.findUniqueOrThrow({ where: { id: planId }, include: { parts: { orderBy: { seq: "asc" } } } });
    expect(plan.status).toBe("COMPLETED");
    expect(plan.parts.map((p) => p.status)).toEqual(["PAID", "PAID", "PAID"]);
    expect((await testDb.invoice.findMany({ where: { planId }, orderBy: { partSeq: "asc" } })).map((i) => i.number)).toEqual([INV(1), INV(2), INV(3)]);
  });

  it("mergeRemainingParts folds the pending parts into one invoice with a single due date", async () => {
    const { createInvoice, mergeRemainingParts } = await import("@/server/finance/invoices");
    const { getInvoiceDetail } = await import("@/server/finance/queries");
    const first = await createInvoice(partInput(seed.client.id));
    if (!first.ok) throw new Error(first.error);
    const merged = await mergeRemainingParts(first.data.planId!, { dueDate: day(10), description: "Balance in one go" });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(merged.data).toMatchObject({ status: "AWAITING_APPROVAL", seq: 4 });
    const parts = await testDb.invoicePart.findMany({ where: { planId: first.data.planId! }, orderBy: { seq: "asc" } });
    expect(parts.map((p) => [p.seq, p.status, p.amount.toNumber()])).toEqual([
      [1, "ISSUED", 10000],
      [2, "MERGED", 6000],
      [3, "MERGED", 4000],
      [4, "ISSUED", 10000],
    ]);
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: merged.data.id }, include: { items: true } });
    expect(inv.total.toNumber()).toBe(11800);
    expect(inv.description).toBe("Balance in one go");
    expect(inv.items[0].description).toBe("Balance in one go — Part 2 of 2 (fixed)");
    expect(inv.dueDate?.toISOString().slice(0, 10)).toBe(day(10));
    const detail = await getInvoiceDetail(first.data.id);
    expect(detail?.planRef?.parts.filter((p) => p.status === "MERGED")).toHaveLength(2);
    expect((await mergeRemainingParts(first.data.planId!, { dueDate: day(10) })).ok).toBe(false);
  });
});
