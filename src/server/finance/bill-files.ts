import { prisma } from "@/lib/db";
import { safeMime } from "@/lib/sanitize";
import { fmtDate } from "@/lib/time";
import { getSettings } from "@/lib/settings";
import { toBytes } from "@/server/finance/drive-store";
import { fileIntoMonth, trashQuietly } from "@/server/finance/month-folders";

/**
 * Vendor bill files on payments (ADR 0009): an image or PDF up to 12 MB, stored on the occurrence and filed into
 * Drive Finance/<paid month>/Expense bills (+ "GST claimable" when the GST comes back). Filing is best effort.
 */
export const MAX_BILL_BYTES = 12 * 1024 * 1024;
export type BillFile = { data: Buffer; mime: string; name: string };

/** Reads `key` from a FormData; validates size and type (images or PDF only). Null when absent. */
export async function readBillFile(fd: FormData | null | undefined, key = "bill"): Promise<BillFile | null> {
  const f = fd?.get(key);
  if (!f || typeof f === "string" || f.size === 0) return null;
  if (f.size > MAX_BILL_BYTES) throw new Error("The bill is too large (max 12 MB)");
  const mime = safeMime(f.type);
  if (!(mime.startsWith("image/") || mime === "application/pdf")) throw new Error("Attach the bill as a photo or a PDF");
  return { data: Buffer.from(await f.arrayBuffer()), mime, name: (f.name || "bill").slice(0, 120) };
}

/** Prisma data that stores a new bill file and forgets the old Drive copies (they are trashed by `refileBill`). */
export function billFileData(file: BillFile) {
  return { billData: toBytes(file.data), billMime: file.mime, billName: file.name, billDriveId: null, itcDriveId: null };
}

const ext = (name: string, mime: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : mime === "application/pdf" ? ".pdf" : ".jpg");
const slug = (s: string) => s.trim().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "payee";

/** File name used in Drive and in the GST pack: `2026-10-05-skyline-spaces-<id>.pdf`. */
export function billFileName(o: { id: string; paidAt: Date | null; dueDate: Date; billName: string | null; billMime: string | null }, payee: string, tz: string): string {
  return `${fmtDate(o.paidAt ?? o.dueDate, tz, "yyyy-MM-dd")}-${slug(payee).toLowerCase()}-${o.id.slice(-6)}${ext(o.billName ?? "", o.billMime ?? "")}`;
}

/**
 * Bring an occurrence's Drive copies in line with its state: a PAID occurrence with a file is filed into Expense bills
 * of the paid month, and also into GST claimable when `itcClaimable && gstAmount > 0`; a copy that no longer applies
 * (unpaid, replaced, not claimable) is trashed. Never throws.
 */
export async function refileBill(occurrenceId: string, trash: (string | null)[] = []): Promise<void> {
  try {
    for (const id of trash) await trashQuietly(id);
    const o = await prisma.expenseOccurrence.findUnique({
      where: { id: occurrenceId },
      select: { id: true, status: true, paidAt: true, dueDate: true, billData: true, billMime: true, billName: true, billDriveId: true, itcDriveId: true, itcClaimable: true, gstAmount: true, expense: { select: { vendor: true } } },
    });
    if (!o) return;
    const paid = o.status === "PAID" && !!o.paidAt;
    const has = !!o.billData && o.billData.length > 0;
    const claim = paid && has && o.itcClaimable && o.gstAmount.toNumber() > 0;
    const data: { billDriveId?: string | null; itcDriveId?: string | null } = {};
    if ((!paid || !has) && o.billDriveId) {
      await trashQuietly(o.billDriveId);
      data.billDriveId = null;
    }
    if (!claim && o.itcDriveId) {
      await trashQuietly(o.itcDriveId);
      data.itcDriveId = null;
    }
    if (paid && has) {
      const file = { name: billFileName(o, o.expense.vendor ?? "payee", (await getSettings()).timezone), mimeType: o.billMime ?? "application/octet-stream", data: Buffer.from(o.billData!) };
      if (!o.billDriveId) data.billDriveId = await fileIntoMonth(o.paidAt!, "bills", file);
      if (claim && !o.itcDriveId) data.itcDriveId = await fileIntoMonth(o.paidAt!, "itc", file);
    }
    if (Object.keys(data).length) await prisma.expenseOccurrence.update({ where: { id: o.id }, data });
  } catch (e) {
    console.error("[bill-files] refile failed", occurrenceId, e instanceof Error ? e.message : e);
  }
}
