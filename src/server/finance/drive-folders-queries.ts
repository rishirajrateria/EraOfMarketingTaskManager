import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { folderUrl } from "@/google/drive";
import { round2 } from "@/server/finance/money";
import { fyRange } from "@/server/finance/tds";
import { ensureFinanceRoot, ensureMonthFolder, financeDriveOwner, monthFolderUrls } from "@/server/finance/month-folders";
import { monthLabelLong } from "@/server/finance/gst-pack";

/**
 * "Monthly Drive folders" page (ADR 0009, ADR 0013): this financial year's months, newest first, with what has been
 * filed into each Finance/YYYY-MM folder, links to open them and the folder ids the Share sheet works on. Folders
 * are created lazily here (first use) when the month job has not made them yet; Drive failures leave the links out.
 * Proformas are never filed, so they never appear in the counts.
 */
export type MonthFolderRow = {
  month: string;
  label: string;
  sales: number;
  bills: number;
  itc: number;
  itcGst: number;
  cancelled: number;
  urls: ReturnType<typeof monthFolderUrls> | null;
  /** Drive id of Finance/YYYY-MM (what the Share sheet shares); null when Drive is unavailable. */
  folderId: string | null;
};

export type DriveFolderMonths = {
  rows: MonthFolderRow[];
  finance: { id: string; url: string } | null;
  /** Whose Google Drive holds the folders (the impersonated Workspace user). */
  owner: string | null;
  fyKey: string;
};

/** yyyy-MM keys from `to` back to `from` (inclusive), newest first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = to.split("-").map(Number);
  const [fy, fm] = from.split("-").map(Number);
  while (y > fy || (y === fy && m >= fm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return out;
}

export async function driveFolderMonths(now = new Date()): Promise<DriveFolderMonths> {
  const tz = (await getSettings()).timezone;
  const fy = fyRange(now, tz);
  const months = monthsBetween(fmtDate(fy.start, tz, "yyyy-MM"), fmtDate(now, tz, "yyyy-MM"));
  const range = { gte: fy.start, lt: fy.end };
  const [invoices, occ] = await Promise.all([
    prisma.invoice.findMany({ where: { approvedAt: range, docType: { in: ["TAX_INVOICE", "EXPORT_INVOICE", "CREDIT_NOTE"] } }, select: { approvedAt: true, cancelReason: true } }),
    prisma.expenseOccurrence.findMany({ where: { status: "PAID", paidAt: range }, select: { paidAt: true, billMime: true, itcClaimable: true, gstAmount: true } }),
  ]);
  const rows = new Map<string, MonthFolderRow>(months.map((m) => [m, { month: m, label: monthLabelLong(m), sales: 0, bills: 0, itc: 0, itcGst: 0, cancelled: 0, urls: null, folderId: null }]));
  for (const i of invoices) {
    const r = rows.get(fmtDate(i.approvedAt!, tz, "yyyy-MM"));
    if (!r) continue;
    if (i.cancelReason) r.cancelled++;
    else r.sales++;
  }
  for (const o of occ) {
    const r = rows.get(fmtDate(o.paidAt!, tz, "yyyy-MM"));
    if (!r) continue;
    const gst = o.gstAmount.toNumber();
    if (o.billMime) r.bills++;
    if (o.itcClaimable && gst > 0 && o.billMime) r.itc++;
    if (o.itcClaimable) r.itcGst = round2(r.itcGst + gst);
  }
  let finance: DriveFolderMonths["finance"] = null;
  try {
    const root = await ensureFinanceRoot();
    finance = { id: root.folderId, url: folderUrl(root.folderId) };
  } catch {
    finance = null;
  }
  for (const r of rows.values()) {
    try {
      const f = await ensureMonthFolder(r.month);
      r.urls = monthFolderUrls(f);
      r.folderId = f.folderId;
    } catch {
      r.urls = null;
    }
  }
  return { rows: Array.from(rows.values()), finance, owner: await financeDriveOwner(), fyKey: fy.key };
}
