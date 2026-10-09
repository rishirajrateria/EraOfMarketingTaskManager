import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { ensurePath } from "@/google/drive";
import { round2 } from "@/server/finance/money";
import { fyRange } from "@/server/finance/tds";
import { ensureMonthFolder, monthFolderUrls } from "@/server/finance/month-folders";
import { monthLabelLong } from "@/server/finance/gst-pack";

/**
 * "Monthly Drive folders" page (ADR 0009, prototype PAGES.drive): this financial year's months, newest first, with
 * what has been filed into each Finance/YYYY-MM folder and links to open them. Folders are created lazily here
 * (first use) when the month job has not made them yet; Drive failures leave the links out.
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

export async function driveFolderMonths(now = new Date()): Promise<{ rows: MonthFolderRow[]; financeUrl: string | null; fyKey: string }> {
  const tz = (await getSettings()).timezone;
  const fy = fyRange(now, tz);
  const months = monthsBetween(fmtDate(fy.start, tz, "yyyy-MM"), fmtDate(now, tz, "yyyy-MM"));
  const range = { gte: fy.start, lt: fy.end };
  const [invoices, occ] = await Promise.all([
    prisma.invoice.findMany({ where: { approvedAt: range, docType: { in: ["TAX_INVOICE", "EXPORT_INVOICE", "CREDIT_NOTE"] } }, select: { approvedAt: true, cancelReason: true } }),
    prisma.expenseOccurrence.findMany({ where: { status: "PAID", paidAt: range }, select: { paidAt: true, billMime: true, itcClaimable: true, gstAmount: true } }),
  ]);
  const rows = new Map<string, MonthFolderRow>(months.map((m) => [m, { month: m, label: monthLabelLong(m), sales: 0, bills: 0, itc: 0, itcGst: 0, cancelled: 0, urls: null }]));
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
  for (const r of rows.values()) {
    try {
      r.urls = monthFolderUrls(await ensureMonthFolder(r.month));
    } catch {
      r.urls = null;
    }
  }
  let financeUrl: string | null = null;
  try {
    financeUrl = (await ensurePath(["Finance"])).url;
  } catch {
    financeUrl = null;
  }
  return { rows: Array.from(rows.values()), financeUrl, fyKey: fy.key };
}
