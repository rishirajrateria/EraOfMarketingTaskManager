"use server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { can, requireUser, ForbiddenError } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { toBytes, tryUpload } from "@/server/finance/drive-store";
import { toCsv } from "@/server/finance/money";
import { listExpenses } from "@/server/finance/queries";
import { expenseFieldsSchema, monthKeySchema, parseInput, type ExpenseFields } from "@/server/finance/schemas";
import { syncExpensesSheet, type SheetSyncResult } from "@/server/finance/sheets-sync";
import { adminIds, notify } from "@/lib/notify";
import { tdsThresholdStatus, tdsWarningText, type TdsThresholdStatus } from "@/server/finance/tds";

/** Expense log server actions (SPEC §11.2). ADMIN only (write via financeWrite, read/export via financeRead). */
const PATH = "/admin/expenses";
const MAX_FILE_BYTES = 12 * 1024 * 1024;

async function requireWrite() {
  const u = await requireUser();
  if (!can.financeWrite(u)) throw new ForbiddenError("Only Admin can change expenses");
  return u;
}
async function requireRead() {
  const u = await requireUser();
  if (!can.financeRead(u)) throw new ForbiddenError("Finance access required");
  return u;
}

async function readUpload(fd: FormData, key: string): Promise<{ data: Buffer; mime: string; name: string } | null> {
  const f = fd.get(key);
  if (!f || typeof f === "string" || f.size === 0) return null;
  if (f.size > MAX_FILE_BYTES) throw new Error(`${key}: file too large (max 12 MB)`);
  return { data: Buffer.from(await f.arrayBuffer()), mime: f.type || "application/octet-stream", name: f.name || key };
}

/** Categories are a fixed list managed in Settings (ADR 0004): reject anything else, normalise to the listed spelling. */
async function fields(fd: FormData) {
  const f = parseInput(expenseFieldsSchema, {
    date: fd.get("date"),
    amount: fd.get("amount"),
    category: fd.get("category"),
    vendor: fd.get("vendor"),
    note: fd.get("note"),
    tags: fd.get("tags"),
    tdsApplied: fd.get("tdsApplied"),
    tdsPercent: fd.get("tdsPercent"),
    tdsAmount: fd.get("tdsAmount"),
  });
  const allowed = (await getSettings()).expenseCategories;
  const category = allowed.find((c) => c.toLowerCase() === f.category.toLowerCase());
  if (!category) throw new Error(`category: "${f.category}" is not in the expense category list (Settings → Expenses)`);
  return { ...f, category };
}

/** Best-effort Drive upload into Finance/Expenses/YYYY-MM (SPEC §11.2). */
async function uploadAttachments(expenseId: string, date: Date, receipt: { data: Buffer; mime: string; name: string } | null, voice: { data: Buffer; mime: string } | null) {
  const tz = (await getSettings()).timezone;
  const folder = ["Finance", "Expenses", fmtDate(date, tz, "yyyy-MM")];
  const ext = receipt?.name.includes(".") ? receipt.name.slice(receipt.name.lastIndexOf(".")) : ".jpg";
  const [receiptImageDriveId, voiceNoteDriveId] = await Promise.all([
    receipt ? tryUpload(folder, { name: `${expenseId}-receipt${ext}`, mimeType: receipt.mime, data: receipt.data }) : null,
    voice ? tryUpload(folder, { name: `${expenseId}-voice.webm`, mimeType: voice.mime, data: voice.data }) : null,
  ]);
  const data: Prisma.ExpenseUpdateInput = {};
  if (receiptImageDriveId) data.receiptImageDriveId = receiptImageDriveId;
  if (voiceNoteDriveId) data.voiceNoteDriveId = voiceNoteDriveId;
  if (Object.keys(data).length) await prisma.expense.update({ where: { id: expenseId }, data });
}

function tdsData(f: ExpenseFields) {
  return { tdsApplied: f.tdsApplied, tdsPercent: f.tdsPercent != null ? new Prisma.Decimal(f.tdsPercent) : null, tdsAmount: new Prisma.Decimal(f.tdsAmount) };
}

export type ExpenseSaveResult = { id: string; tdsWarning: string | null };

/**
 * ADR 0006: after saving, check the payee's FY total against the threshold. The expense is saved either way;
 * when TDS is due but was not deducted, every admin is notified and the warning is returned to the form.
 */
async function warnIfThresholdCrossed(f: ExpenseFields, expenseId: string): Promise<string | null> {
  if (!f.vendor) return null;
  const status = await tdsThresholdStatus(f.vendor, f.amount, f.date, expenseId);
  const warning = tdsWarningText(status, f.tdsApplied);
  if (!warning) return null;
  await notify({
    userIds: await adminIds(),
    kind: "TDS_THRESHOLD",
    title: `TDS threshold crossed for ${status.vendor}`,
    body: `₹${status.withThis.toLocaleString("en-IN")} paid this FY, threshold ₹${status.threshold.toLocaleString("en-IN")} — deduct TDS on payments to this payee`,
    href: PATH,
  });
  return warning;
}

/** Live check for the expense form: where this payee stands against the TDS threshold with `amount` added. */
export async function vendorTdsStatus(vendor: string, amount: number, date: string | Date, excludeExpenseId?: string | null): Promise<ActionResult<TdsThresholdStatus>> {
  return wrap(async () => {
    await requireRead();
    const d = new Date(date);
    return tdsThresholdStatus(String(vendor ?? ""), Number(amount) || 0, Number.isNaN(d.getTime()) ? new Date() : d, excludeExpenseId ?? null);
  });
}

export async function createExpense(fd: FormData): Promise<ActionResult<ExpenseSaveResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const f = await fields(fd);
    const [receipt, voice] = await Promise.all([readUpload(fd, "receipt"), readUpload(fd, "voice")]);
    const voiceDuration = Number(fd.get("voiceDurationSec") ?? 0) || 0;
    const e = await prisma.expense.create({
      data: {
        date: f.date,
        amount: new Prisma.Decimal(f.amount),
        category: f.category,
        vendor: f.vendor,
        note: f.note,
        tags: f.tags,
        ...tdsData(f),
        createdById: actor.id,
        receiptImageData: receipt ? toBytes(receipt.data) : undefined,
        receiptImageMime: receipt?.mime,
        voiceNoteData: voice ? toBytes(voice.data) : undefined,
        voiceNoteDurationSec: voice ? Math.round(voiceDuration) : undefined,
      },
    });
    await audit(actor.id, "expense.create", "Expense", e.id, undefined, { ...f, hasReceipt: !!receipt, hasVoice: !!voice });
    await uploadAttachments(e.id, f.date, receipt, voice);
    const tdsWarning = await warnIfThresholdCrossed(f, e.id);
    safeRevalidate(PATH, "/admin/finance");
    return { id: e.id, tdsWarning };
  });
}

export async function updateExpense(id: string, fd: FormData): Promise<ActionResult<ExpenseSaveResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const before = await prisma.expense.findUnique({ where: { id }, select: { date: true, amount: true, category: true, vendor: true, note: true, tags: true, tdsApplied: true, tdsAmount: true } });
    if (!before) throw new Error("Expense not found");
    const f = await fields(fd);
    const [receipt, voice] = await Promise.all([readUpload(fd, "receipt"), readUpload(fd, "voice")]);
    const voiceDuration = Number(fd.get("voiceDurationSec") ?? 0) || 0;
    await prisma.expense.update({
      where: { id },
      data: {
        date: f.date,
        amount: new Prisma.Decimal(f.amount),
        category: f.category,
        vendor: f.vendor,
        note: f.note,
        tags: f.tags,
        ...tdsData(f),
        ...(receipt ? { receiptImageData: toBytes(receipt.data), receiptImageMime: receipt.mime, receiptImageDriveId: null } : {}),
        ...(voice ? { voiceNoteData: toBytes(voice.data), voiceNoteDurationSec: Math.round(voiceDuration), voiceNoteDriveId: null } : {}),
      },
    });
    await audit(actor.id, "expense.update", "Expense", id, { ...before, amount: before.amount.toNumber(), tdsAmount: before.tdsAmount.toNumber() }, f);
    await uploadAttachments(id, f.date, receipt, voice);
    const tdsWarning = await warnIfThresholdCrossed(f, id);
    safeRevalidate(PATH, "/admin/finance");
    return { id, tdsWarning };
  });
}

export async function deleteExpense(id: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const before = await prisma.expense.findUnique({ where: { id }, select: { date: true, amount: true, category: true, vendor: true } });
    if (!before) throw new Error("Expense not found");
    await prisma.expense.delete({ where: { id } });
    await audit(actor.id, "expense.delete", "Expense", id, { ...before, amount: before.amount.toNumber() }, null);
    safeRevalidate(PATH, "/admin/finance");
    return undefined;
  });
}

/** CSV of the filtered expenses; the client turns the string into a Blob download. */
export async function exportExpensesCsv(filter: { month?: string | null; category?: string | null } = {}): Promise<ActionResult<string>> {
  return wrap(async () => {
    await requireRead();
    const month = filter.month ? parseInput(monthKeySchema, filter.month) : null;
    const tz = (await getSettings()).timezone;
    const { rows, total } = await listExpenses({ month, category: filter.category ?? null });
    const table: unknown[][] = [["date", "amount", "category", "vendor", "note", "tags", "tdsApplied", "tdsPercent", "tdsAmount", "netPaid", "createdBy"]];
    for (const e of rows) {
      table.push([fmtDate(new Date(e.date), tz, "yyyy-MM-dd"), e.amount.toFixed(2), e.category, e.vendor ?? "", e.note ?? "", e.tags.join("|"), e.tdsApplied ? "yes" : "no", e.tdsPercent ?? "", e.tdsAmount.toFixed(2), (e.amount - e.tdsAmount).toFixed(2), e.createdBy]);
    }
    const tds = rows.reduce((s, r) => s + r.tdsAmount, 0);
    table.push([], ["TOTAL", total.toFixed(2)], ["TOTAL TDS", tds.toFixed(2)], ["TOTAL NET PAID", (total - tds).toFixed(2)]);
    return toCsv(table);
  });
}

export async function syncExpensesToSheet(): Promise<ActionResult<SheetSyncResult>> {
  return wrap(async () => {
    const actor = await requireWrite();
    const res = await syncExpensesSheet(actor.id);
    safeRevalidate(PATH);
    return res;
  });
}
