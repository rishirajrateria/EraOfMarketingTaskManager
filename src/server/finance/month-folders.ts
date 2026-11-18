import type { FinanceDriveRoot, FinanceMonthFolder } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { isMock } from "@/google/client";
import { ensureFolder, ensurePath, folderUrl, trashFile, updateFile, uploadFile } from "@/google/drive";
import { invoiceFileName, type FileNameDoc } from "@/server/finance/file-names";

/**
 * Monthly Drive folders (ADR 0009, ADR 0013): Finance/YYYY-MM with "Sales invoices", "Expense bills", "GST claimable"
 * and "Cancelled invoices". Every Drive call impersonates GOOGLE_IMPERSONATE_USER (domain-wide delegation), so the
 * Finance root is created in that person's My Drive (or under GOOGLE_DRIVE_ROOT_FOLDER_ID when set) — never in the
 * service account's own drive. Created on the 1st by the month-folders job, or lazily the first time something is
 * filed. Folder ids are cached (FinanceDriveRoot, FinanceMonthFolder) so each month costs Drive calls once. Every
 * filing helper is best effort: Google failures never block the finance action (SPEC §14).
 */
export const MONTH_SUBFOLDERS = { sales: "Sales invoices", bills: "Expense bills", itc: "GST claimable", cancelled: "Cancelled invoices" } as const;
export type MonthSub = keyof typeof MONTH_SUBFOLDERS;
const SUB_COLUMN: Record<MonthSub, "salesId" | "billsId" | "itcId" | "cancelledId"> = { sales: "salesId", bills: "billsId", itc: "itcId", cancelled: "cancelledId" };

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PDF = "application/pdf";

/** yyyy-MM of an instant in the company timezone. */
export async function monthKeyOf(d: Date): Promise<string> {
  return fmtDate(d, (await getSettings()).timezone, "yyyy-MM");
}

/**
 * Whose Google Drive holds the finance folders: the impersonated Workspace user. In GOOGLE_MOCK (demo / CI) without
 * one configured, the first active Admin stands in so the page can still say whose Drive it would be.
 */
export async function financeDriveOwner(): Promise<string | null> {
  if (env.impersonateUser) return env.impersonateUser.toLowerCase();
  if (!isMock()) return null;
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" }, select: { email: true } });
  return admin?.email ?? null;
}

/**
 * Idempotent: the cached Finance root, else `Finance` in the owner's My Drive (or the configured root folder).
 * Refuses in live mode when no user is impersonated and no root folder is configured, because the folder would
 * otherwise land in the service account's private drive where the owner can neither see nor share it.
 */
export async function ensureFinanceRoot(): Promise<FinanceDriveRoot> {
  const owner = await financeDriveOwner();
  const cached = await prisma.financeDriveRoot.findUnique({ where: { id: "default" } });
  if (cached && (isMock() || cached.ownerEmail === owner)) return cached;
  if (!isMock() && !env.impersonateUser && !env.driveRootFolderId) {
    throw new Error("Set GOOGLE_IMPERSONATE_USER so the Finance folders are created in the owner's Google Drive");
  }
  const root = await ensurePath(["Finance"]);
  return prisma.financeDriveRoot.upsert({
    where: { id: "default" },
    update: { folderId: root.id, ownerEmail: owner },
    create: { id: "default", folderId: root.id, ownerEmail: owner },
  });
}

/** Idempotent: returns the cached folder row, else creates Finance/<month> + the four subfolders and stores their ids. */
export async function ensureMonthFolder(month: string): Promise<FinanceMonthFolder> {
  if (!MONTH_RE.test(month)) throw new Error("month must be yyyy-MM");
  const existing = await prisma.financeMonthFolder.findUnique({ where: { month } });
  if (existing) return existing;
  const finance = await ensureFinanceRoot();
  const root = await ensureFolder(month, finance.folderId);
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

type FilableInvoice = FileNameDoc & { id: string; approvedAt: Date | null; cancelledAt?: Date | null; monthDriveFileId: string | null };

/**
 * Approved sales documents (tax / export invoices, credit notes) are filed once into "Sales invoices" of their
 * issue (approval) month as "Invoice No. … (<Client>).pdf". Proformas are never filed (ADR 0013: a proforma is not a
 * record). Re-sends do not file again.
 */
export async function fileSalesInvoice(inv: FilableInvoice, pdf: Buffer): Promise<string | null> {
  if (inv.docType === "PROFORMA" || inv.monthDriveFileId || !inv.approvedAt) return inv.monthDriveFileId;
  const id = await fileIntoMonth(inv.approvedAt, "sales", { name: invoiceFileName(inv), mimeType: PDF, data: pdf });
  if (id) await prisma.invoice.update({ where: { id: inv.id }, data: { monthDriveFileId: id } });
  return id;
}

/**
 * A cancelled invoice's stamped copy lives in "Cancelled invoices" of its issue month as
 * "C Invoice No. … (<Client>).pdf": the Sales invoices copy is moved there, renamed and its content replaced by the
 * stamped PDF; when there is no copy (or it was deleted in Drive) the stamped PDF is uploaded under that name.
 */
export async function fileCancelledInvoice(inv: FilableInvoice, pdf: Buffer): Promise<string | null> {
  const name = invoiceFileName(inv, { cancelled: true });
  const at = inv.approvedAt ?? inv.cancelledAt ?? new Date();
  if (inv.monthDriveFileId) {
    try {
      const folder = await ensureMonthFolder(await monthKeyOf(at));
      const moved = await updateFile({ fileId: inv.monthDriveFileId, name, addParent: folder.cancelledId, removeParent: folder.salesId, mimeType: PDF, data: pdf });
      if (moved) return inv.monthDriveFileId;
    } catch (e) {
      console.error("[month-folders] move to Cancelled failed", inv.id, e instanceof Error ? e.message : e);
    }
  }
  const id = await fileIntoMonth(at, "cancelled", { name, mimeType: PDF, data: pdf });
  if (!id) return null;
  await trashQuietly(inv.monthDriveFileId);
  await prisma.invoice.update({ where: { id: inv.id }, data: { monthDriveFileId: id } });
  return id;
}
