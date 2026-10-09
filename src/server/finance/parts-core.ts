import type { InvoicePart, InvoicePlan, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { round2 } from "@/server/finance/money";
import { D, insertDocument, loadClientTax, loadInvoiceFull, singleRow, type InvoiceFull } from "@/server/finance/document-core";
import type { PartInput } from "@/server/finance/schemas";

/**
 * Part-payment plans (ADR 0005): a schedule of parts, each issued as its own invoice on its due date
 * (job) or early (`issuePart`). Remaining PENDING parts can be merged into one or re-scheduled.
 */
type Tx = Prisma.TransactionClient;
const TOLERANCE = 0.01;

export type ResolvedPart = { seq: number; kind: "PERCENT" | "FIXED"; value: number; amount: number; dueDate: Date; description: string };

/** Percent parts are a share of the plan's taxable total; fixed parts are taken as entered. */
function amountsFor(parts: PartInput[], planTotal: number, firstSeq: number): ResolvedPart[] {
  return parts.map((p, i) => ({
    seq: firstSeq + i,
    kind: p.kind,
    value: round2(p.value),
    amount: round2(p.kind === "PERCENT" ? (planTotal * p.value) / 100 : p.value),
    dueDate: p.dueDate,
    description: p.description,
  }));
}

function assertSum(resolved: ResolvedPart[], expected: number, what: string): void {
  const sum = round2(resolved.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(sum - expected) > TOLERANCE) throw new Error(`${what} add up to ${sum} but must equal ${expected}`);
}

/** Resolve % / fixed parts against the taxable total; they must add up to the total (±0.01). */
export function resolveParts(parts: PartInput[], total: number, firstSeq = 1): ResolvedPart[] {
  const resolved = amountsFor(parts, total, firstSeq);
  assertSum(resolved, total, "Parts");
  return resolved;
}

export type PlanWithParts = InvoicePlan & { parts: InvoicePart[] };

export async function loadPlan(planId: string, tx: Tx | typeof prisma = prisma): Promise<PlanWithParts> {
  const plan = await tx.invoicePlan.findUnique({ where: { id: planId }, include: { parts: { orderBy: { seq: "asc" } } } });
  if (!plan) throw new Error("Payment plan not found");
  return plan;
}

export async function createPlan(tx: Tx, input: { clientId: string; title: string; description: string; totalAmount: number; gstPercent: number; parts: ResolvedPart[]; createdById: string }): Promise<PlanWithParts> {
  return tx.invoicePlan.create({
    data: {
      clientId: input.clientId,
      title: input.title,
      description: input.description,
      totalAmount: D(input.totalAmount),
      gstPercent: D(input.gstPercent),
      createdById: input.createdById,
      parts: { create: input.parts.map((p) => ({ seq: p.seq, kind: p.kind, value: D(p.value), amount: D(p.amount), dueDate: p.dueDate, description: p.description })) },
    },
    include: { parts: { orderBy: { seq: "asc" } } },
  });
}

/** "Part 2 of 3": position among the parts that still count (merged / cancelled ones are skipped). */
export function partPosition(parts: Pick<InvoicePart, "seq" | "status">[], seq: number): { index: number; count: number } {
  const active = parts.filter((p) => p.status !== "MERGED" && p.status !== "CANCELLED").sort((a, b) => a.seq - b.seq);
  const index = active.findIndex((p) => p.seq === seq) + 1;
  return { index: index || seq, count: Math.max(active.length, index) };
}

function partDescription(plan: InvoicePlan, part: InvoicePart, pos: { index: number; count: number }): string {
  const share = part.kind === "PERCENT" ? `${part.value.toNumber()}%` : "fixed";
  const base = part.description || plan.title;
  return `${base} — Part ${pos.index} of ${pos.count} (${share})`;
}

/**
 * Issue one PENDING part as an AWAITING_APPROVAL invoice. Tax is resolved for the client at issue time and the
 * invoice inherits the plan's GST percent. Idempotent: an already issued part returns its invoice.
 */
export async function issuePartCore(planId: string, seq: number, actorId: string | null, opts: { dueDate?: Date | null; description?: string | null } = {}): Promise<InvoiceFull> {
  const plan = await loadPlan(planId);
  const part = plan.parts.find((p) => p.seq === seq);
  if (!part) throw new Error(`Part ${seq} not found`);
  if (part.invoiceId) {
    const existing = await loadInvoiceFull(part.invoiceId);
    if (existing) return existing;
  }
  if (part.status !== "PENDING") throw new Error(`Part ${seq} is ${part.status.toLowerCase()} and cannot be issued`);
  if (plan.status !== "ACTIVE") throw new Error("Payment plan is not active");
  const { tax } = await loadClientTax(plan.clientId);
  const pos = partPosition(plan.parts, part.seq);
  return prisma.$transaction(async (tx) => {
    const inv = await insertDocument(
      tx,
      {
        clientId: plan.clientId,
        docType: tax.docType,
        taxMode: tax.taxMode,
        placeOfSupply: tax.placeOfSupply,
        plan: "PART",
        planId: plan.id,
        partSeq: part.seq,
        gstPercent: plan.gstPercent.toNumber(),
        items: singleRow(partDescription(plan, part, pos), part.amount.toNumber()),
        description: opts.description ?? plan.description,
        dueDate: opts.dueDate ?? part.dueDate,
      },
      actorId,
      "invoice.part_issue",
      { planId: plan.id, seq: part.seq },
    );
    await tx.invoicePart.update({ where: { id: part.id }, data: { status: "ISSUED", invoiceId: inv.id } });
    return inv;
  });
}

/** Fold every PENDING part into one new part for the remaining amount and issue it (ADR 0005). */
export async function mergeRemainingPartsCore(planId: string, input: { dueDate: Date; description?: string | null }, actorId: string | null): Promise<InvoiceFull> {
  const plan = await loadPlan(planId);
  const pending = plan.parts.filter((p) => p.status === "PENDING");
  if (pending.length === 0) throw new Error("No pending parts to merge");
  const amount = round2(pending.reduce((s, p) => s + p.amount.toNumber(), 0));
  const seq = Math.max(...plan.parts.map((p) => p.seq)) + 1;
  await prisma.$transaction(async (tx) => {
    await tx.invoicePart.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: "MERGED" } });
    await tx.invoicePart.create({
      data: { planId: plan.id, seq, kind: "FIXED", value: D(amount), amount: D(amount), dueDate: input.dueDate, description: input.description ?? `Remaining balance (parts ${pending.map((p) => p.seq).join(", ")})` },
    });
    await audit(actorId, "invoice.parts_merge", "InvoicePlan", plan.id, { pending: pending.map((p) => p.seq) }, { seq, amount }, tx);
  });
  return issuePartCore(plan.id, seq, actorId, { description: input.description });
}

/** Replace the PENDING parts of a plan; issued/paid parts stay and the new schedule must still sum to the plan total. */
export async function updatePartScheduleCore(planId: string, parts: PartInput[], actorId: string | null): Promise<PlanWithParts> {
  const plan = await loadPlan(planId);
  if (plan.status !== "ACTIVE") throw new Error("Payment plan is not active");
  const fixed = plan.parts.filter((p) => p.status !== "PENDING" && p.status !== "MERGED" && p.status !== "CANCELLED");
  const fixedAmount = round2(fixed.reduce((s, p) => s + p.amount.toNumber(), 0));
  const remaining = round2(plan.totalAmount.toNumber() - fixedAmount);
  if (remaining <= 0) throw new Error("Every part has already been issued");
  const resolved = amountsFor(parts, plan.totalAmount.toNumber(), Math.max(0, ...plan.parts.map((p) => p.seq)) + 1);
  assertSum(resolved, remaining, "The pending parts");
  const pendingIds = plan.parts.filter((p) => p.status === "PENDING").map((p) => p.id);
  await prisma.$transaction(async (tx) => {
    await tx.invoicePart.deleteMany({ where: { id: { in: pendingIds } } });
    await tx.invoicePart.createMany({ data: resolved.map((p) => ({ planId: plan.id, seq: p.seq, kind: p.kind, value: D(p.value), amount: D(p.amount), dueDate: p.dueDate, description: p.description })) });
    await audit(actorId, "invoice.parts_update", "InvoicePlan", plan.id, { pending: pendingIds.length }, { parts: resolved.map((p) => ({ seq: p.seq, amount: p.amount })) }, tx);
  });
  return loadPlan(plan.id);
}

/** Sync part status from its invoice (PAID / CANCELLED) and complete the plan when nothing is left open. */
export async function syncPartFromInvoice(tx: Tx | typeof prisma, invoiceId: string, invoiceStatus: "PAID" | "CANCELLED"): Promise<void> {
  const part = await tx.invoicePart.findUnique({ where: { invoiceId } });
  if (!part) return;
  await tx.invoicePart.update({ where: { id: part.id }, data: { status: invoiceStatus } });
  const parts = await tx.invoicePart.findMany({ where: { planId: part.planId } });
  const done = parts.every((p) => p.status === "PAID" || p.status === "MERGED" || p.status === "CANCELLED") && parts.some((p) => p.status === "PAID");
  if (done) await tx.invoicePlan.update({ where: { id: part.planId }, data: { status: "COMPLETED" } });
}
