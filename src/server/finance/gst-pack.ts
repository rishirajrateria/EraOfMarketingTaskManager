import { strToU8, zipSync, type Zippable } from "fflate";
import { addMonths } from "date-fns";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";
import { fmtDate, parseDateKey } from "@/lib/time";
import { sendMail } from "@/google/gmail";
import { formatCurrency, round2, toCsv } from "@/server/finance/money";
import { billFileName } from "@/server/finance/bill-files";
import { financeEmailSchema, monthKeySchema, parseInput } from "@/server/finance/schemas";

/**
 * Monthly GST credit pack (ADR 0009): a ZIP of the month's claimable expense bills (paid in that month, GST included,
 * "I'll get this GST back") plus summary.csv, for the finance person. Download via GET /api/finance/gst-pack or email
 * it with `sendGstPackCore` (the address is remembered in Settings.financeEmail).
 */
export const SUMMARY_HEADERS = ["date", "payee", "vendor GSTIN", "bill amount", "GST rate", "GST amount", "file name"] as const;

export type GstPackRow = { occurrenceId: string; date: string; payee: string; vendorGstin: string; amount: number; gstRate: number | null; gstAmount: number; fileName: string | null };
export type GstPack = { month: string; label: string; rows: GstPackRow[]; attached: number; missing: number; gstTotal: number; csv: string; zip: Buffer; fileName: string };

export function monthLabelLong(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

export async function buildGstPack(monthRaw: string): Promise<GstPack> {
  const month = parseInput(monthKeySchema, monthRaw);
  const tz = (await getSettings()).timezone;
  const start = parseDateKey(`${month}-01`, tz);
  const occ = await prisma.expenseOccurrence.findMany({
    where: { status: "PAID", paidAt: { gte: start, lt: addMonths(start, 1) }, itcClaimable: true, gstAmount: { gt: 0 } },
    orderBy: [{ paidAt: "asc" }, { id: "asc" }],
    select: { id: true, paidAt: true, dueDate: true, amount: true, gstRate: true, gstAmount: true, vendorGstin: true, billData: true, billMime: true, billName: true, expense: { select: { vendor: true, vendorGstin: true } } },
  });
  const files: Zippable = {};
  const rows: GstPackRow[] = occ.map((o) => {
    const payee = o.expense.vendor ?? "";
    const has = !!o.billData && o.billData.length > 0;
    const fileName = has ? billFileName(o, payee, tz) : null;
    if (fileName) files[fileName] = new Uint8Array(o.billData!);
    return {
      occurrenceId: o.id,
      date: fmtDate(o.paidAt!, tz, "yyyy-MM-dd"),
      payee,
      vendorGstin: o.vendorGstin ?? o.expense.vendorGstin ?? "",
      amount: o.amount.toNumber(),
      gstRate: o.gstRate?.toNumber() ?? null,
      gstAmount: o.gstAmount.toNumber(),
      fileName,
    };
  });
  const gstTotal = round2(rows.reduce((s, r) => s + r.gstAmount, 0));
  const csv = toCsv([
    [...SUMMARY_HEADERS],
    ...rows.map((r) => [r.date, r.payee, r.vendorGstin, r.amount.toFixed(2), r.gstRate ?? "", r.gstAmount.toFixed(2), r.fileName ?? "MISSING"]),
    [],
    ["TOTAL", "", "", round2(rows.reduce((s, r) => s + r.amount, 0)).toFixed(2), "", gstTotal.toFixed(2), ""],
  ]);
  files["summary.csv"] = strToU8(csv);
  const zip = Buffer.from(zipSync(files, { level: 6 }));
  const attached = rows.filter((r) => r.fileName).length;
  return { month, label: monthLabelLong(month), rows, attached, missing: rows.length - attached, gstTotal, csv, zip, fileName: `GST-pack-${month}.zip` };
}

/** Plain-text email body: totals, then one line per bill. */
export function packSummaryText(p: GstPack, company: string): string {
  const lines = [
    `GST credit pack for ${p.label}`,
    "",
    `Claimable bills: ${p.rows.length} (${p.attached} attached${p.missing ? `, ${p.missing} missing` : ""})`,
    `GST to claim: ${formatCurrency(p.gstTotal)}`,
    "",
    ...p.rows.map((r) => `${r.date} · ${r.payee} · ${r.vendorGstin || "no GSTIN"} · bill ${formatCurrency(r.amount)} · GST ${formatCurrency(r.gstAmount)}${r.gstRate != null ? ` @ ${r.gstRate}%` : ""}${r.fileName ? "" : " · bill missing"}`),
    "",
    "The bills and summary.csv are attached as a ZIP.",
    "",
    `— ${company}`,
  ];
  return lines.join("\n");
}

export type SendPackResult = { to: string; bills: number; attached: number; missing: number; gstTotal: number };

/** Saves the finance person's email in Settings and emails them the month's ZIP with the summary in the body. */
export async function sendGstPackCore(month: string, emailRaw: string, actorId: string): Promise<SendPackResult> {
  const to = parseInput(financeEmailSchema, emailRaw);
  const pack = await buildGstPack(month);
  await prisma.companySettings.update({ where: { id: "default" }, data: { financeEmail: to } });
  invalidateSettingsCache();
  if (pack.rows.length === 0) throw new Error(`No claimable GST bills paid in ${pack.label}`);
  const company = (await getSettings()).companyName;
  await sendMail({
    to,
    subject: `GST credit pack · ${pack.label} · ${company}`,
    text: packSummaryText(pack, company),
    attachments: [{ filename: pack.fileName, mimeType: "application/zip", data: pack.zip }],
    sender: "finance",
  });
  await audit(actorId, "finance.gst_pack_send", "GstPack", pack.month, undefined, { to, bills: pack.rows.length, attached: pack.attached, gst: pack.gstTotal });
  return { to, bills: pack.rows.length, attached: pack.attached, missing: pack.missing, gstTotal: pack.gstTotal };
}
