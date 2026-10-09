import type { FinanceMonthFolder } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { ensureFolder, ensurePath, folderUrl, trashFile, uploadFile } from "@/google/drive";

/**
 * Monthly Drive folders (ADR 0009): Finance/YYYY-MM with "Sales invoices", "Expense bills", "GST claimable" and
 * "Cancelled invoices". Created on the 1st by the month-folders job, or lazily the first time something is filed.
 * Folder ids are cached in FinanceMonthFolder so each month costs Drive calls once. Every filing helper is best
 * effort: Google failures never block the finance action (SPEC §14).
 */
export const MONTH_SUBFOLDERS = { sales: "Sales invoices", bills: "Expense bills", itc: "GST claimable", cancelled: "Cancelled invoices" } as const;
export type MonthSub = keyof typeof MONTH_SUBFOLDERS;
const SUB_COLUMN: Record<MonthSub, "salesId" | "billsId" | "itcId" | "cancelledId"> = { sales: "salesId", bills: "billsId", itc: "itcId", cancelled: "cancelledId" };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** yyyy-MM of an instant in the company timezone. */
export async function monthKeyOf(d: Date): Promise<string> {
  return fmtDate(d, (await getSettings()).timezone, "yyyy-MM");
}

/** Idempotent: returns the cached folder row, else creates Finance/<month> + the four subfolders and stores their ids. */
export async function ensureMonthFolder(month: string): Promise<FinanceMonthFolder> {
  if (!MONTH_RE.test(month)) throw new Error("month must be yyyy-MM");
  const existing = await prisma.financeMonthFolder.findUnique({ where: { month } });
  if (existing) return existing;
  const root = await ensurePath(["Finance", month]);
  const [sales, bills, itc, cancelled] = await Promise.all([MONTH_SUBFOLDERS.sales, MONTH_SUBFOLDERS.bills, MONTH_SUBFOLDERS.itc, MONTH_SUBFOLDERS.cancelled].map((name) => ensureFolder(name, root.id)));
  return prisma.financeMonthFolder.upsert({
    where: { month },
    update: {},
    create: { month, folderId: root.id, salesId: sales.id, billsId: bills.id, itcId: itc.id, cancelledId: cancelled.id },
  });
}

export function monthFolderUrls(f: FinanceMonthFolder) {
  return { folder: folderUrl(f.folderId), sales: folderUrl(f.salesId), bills: folderUrl(f.billsId), itc: folderUrl(f.itcId), cancelled: folderUrl(f.cancelledId) };
}

/** Upload into Finance/<month of `at`>/<sub>; returns the Drive file id or null when Drive is unavailable. */
export async function fileIntoMonth(at: Date, sub: MonthSub, file: { name: string; mimeType: string; data: Buffer }): Promise<string | null> {
  try {
    const folder = await ensureMonthFolder(await monthKeyOf(at));
    const res = await uploadFile({ name: file.name, mimeType: file.mimeType, data: file.data, parentId: folder[SUB_COLUMN[sub]] });
    return res.id;
  } catch (e) {
    console.error("[month-folders] filing failed", sub, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Best-effort trash of a filed copy. */
export async function trashQuietly(fileId: string | null | undefined): Promise<void> {
  if (!fileId) return;
  try {
    await trashFile(fileId);
  } catch (e) {
    console.error("[month-folders] trash failed", fileId, e instanceof Error ? e.message : e);
  }
}

const pdfName = (number: string) => `${number.replace(/[^\w.-]+/g, "_")}.pdf`;

/**
 * Approved sales documents (tax / export invoices, credit notes) are filed once into "Sales invoices" of their
 * issue (approval) month. Proformas are not filed. Re-sends do not file again.
 */
export async function fileSalesInvoice(inv: { id: string; number: string; docType: string; approvedAt: Date | null; monthDriveFileId: string | null }, pdf: Buffer): Promise<string | null> {
  if (inv.docType === "PROFORMA" || inv.monthDriveFileId || !inv.approvedAt) return inv.monthDriveFileId;
  const id = await fileIntoMonth(inv.approvedAt, "sales", { name: pdfName(inv.number), mimeType: "application/pdf", data: pdf });
  if (id) await prisma.invoice.update({ where: { id: inv.id }, data: { monthDriveFileId: id } });
  return id;
}

/** A cancelled invoice's stamped copy goes to "Cancelled invoices" of its issue month; the Sales invoices copy is trashed. */
export async function fileCancelledInvoice(inv: { id: string; number: string; approvedAt: Date | null; cancelledAt: Date | null; monthDriveFileId: string | null }, pdf: Buffer): Promise<string | null> {
  const id = await fileIntoMonth(inv.approvedAt ?? inv.cancelledAt ?? new Date(), "cancelled", { name: `${pdfName(inv.number).replace(/\.pdf$/, "")}-CANCELLED.pdf`, mimeType: "application/pdf", data: pdf });
  if (!id) return null;
  await trashQuietly(inv.monthDriveFileId);
  await prisma.invoice.update({ where: { id: inv.id }, data: { monthDriveFileId: id } });
  return id;
}
