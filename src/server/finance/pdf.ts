import PDFDocument from "pdfkit";
import { round2 } from "@/server/finance/money";
import { upiQrPng } from "@/server/finance/qr";
import type { DocType, TaxMode } from "@/server/finance/tax";
import {
  COL2,
  FOOTER_Y,
  M,
  PAGE_H,
  PAGE_W,
  PT,
  W,
  amount,
  collect,
  companyLines,
  fmtDMY,
  footer,
  heightOf,
  metaLine,
  partyColumns,
  partyLines,
  payToLines,
  registerFonts,
  rule,
  signatureBlock,
  text,
  titleRow,
  type Doc,
  type PdfCompany,
  type PdfParty,
} from "@/server/finance/pdf-base";

/**
 * Invoice / proforma / export invoice / credit note PDF in the owner's template (ADR 0007): meta line top right,
 * logo + brand + title, Invoice To / Invoice From columns, Pay To block (UPI QR beside it when a UPI id is set),
 * item table (Amount | Tax | Total for GST documents, Description | Total otherwise), totals block bottom right,
 * signature bottom left, website / HSN / time footer. Returns a Buffer.
 */
export type { PdfCompany, PdfParty } from "@/server/finance/pdf-base";
export { renderReceiptPdf, type PdfReceipt } from "@/server/finance/pdf-receipt";

export type PdfInvoice = {
  number: string;
  issuedAt: Date;
  dueDate?: Date | null;
  docType?: DocType;
  taxMode?: TaxMode;
  /** ISO 4217; amounts are stored as entered (no FX). Default INR. */
  currency?: string | null;
  placeOfSupply?: string | null;
  description?: string | null;
  /** "Part 2 of 3" for part-payment invoices. */
  partLabel?: string | null;
  /** Number of the invoice a credit note offsets. */
  creditNoteOf?: string | null;
  items: { description: string; hsnSac?: string | null; qty: number; unit: "HOURS" | "FIXED"; rate: number; amount: number }[];
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  cgstAmount?: number;
  sgstAmount?: number;
  igstAmount?: number;
  total: number;
  notes?: string | null;
  paymentTerms?: string | null;
  status?: string;
  /** ADR 0009: a cancelled invoice is re-rendered with a rotated red CANCELLED stamp and this reason. */
  cancelReason?: string | null;
  cancelledAt?: Date | null;
};

const DRAFT = /^DRAFT-/;
const TOTAL_ANCHOR_Y = 773; // y of the bold "Total amount to be paid" line when the table is short (as in the reference)
const ROW_LIMIT_Y = 640; // start a new page when rows would run past this

export function documentTitle(inv: Pick<PdfInvoice, "docType">): string {
  switch (inv.docType) {
    case "EXPORT_INVOICE":
      return "Export Invoice";
    case "PROFORMA":
      return "Proforma Invoice";
    case "CREDIT_NOTE":
      return "Credit Note";
    default:
      return "Tax Invoice";
  }
}

/** "Invoice No. 45  08/10/2026" / "Proforma Invoice  08/10/2026" / "Credit Note CN-1  08/10/2026". */
export function metaText(inv: Pick<PdfInvoice, "docType" | "number" | "issuedAt">, tz: string): string {
  const date = fmtDMY(inv.issuedAt, tz);
  const draft = DRAFT.test(inv.number);
  if (inv.docType === "PROFORMA") return `Proforma Invoice  ${date}`;
  if (inv.docType === "CREDIT_NOTE") return draft ? `Credit Note (draft)  ${date}` : `Credit Note ${inv.number}  ${date}`;
  return draft ? `Draft invoice  ${date}` : `Invoice No. ${inv.number}  ${date}`;
}

const pct = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

/** Tax lines per mode (ADR 0005): CGST + SGST halves or IGST; zero-rated / no-tax documents have none. */
export function taxRows(inv: PdfInvoice): [string, number][] {
  switch (inv.taxMode) {
    case "IGST":
      return [[`IGST ${pct(inv.gstPercent)}%`, inv.igstAmount ?? inv.gstAmount]];
    case "CGST_SGST":
      return [
        [`CGST ${pct(inv.gstPercent / 2)}%`, inv.cgstAmount ?? inv.gstAmount / 2],
        [`SGST ${pct(inv.gstPercent / 2)}%`, inv.sgstAmount ?? inv.gstAmount / 2],
      ];
    default:
      return [];
  }
}

const hasTaxColumns = (inv: PdfInvoice) => (inv.taxMode === "CGST_SGST" || inv.taxMode === "IGST") && inv.gstPercent > 0;

async function qrFor(inv: PdfInvoice, company: PdfCompany): Promise<Buffer | null> {
  if (!company.upiId || inv.docType === "CREDIT_NOTE" || inv.total <= 0 || (inv.currency ?? "INR") !== "INR") return null;
  try {
    return await upiQrPng({ upiId: company.upiId, payeeName: company.companyName, amount: inv.total, note: inv.number });
  } catch {
    return null;
  }
}

type Ctx = { doc: Doc; inv: PdfInvoice; company: PdfCompany; cur: string; sym: boolean; title: string; tz: string; now: Date };

function pageTop(c: Ctx): number {
  metaLine(c.doc, metaText(c.inv, c.tz));
  return titleRow(c.doc, c.company, c.title);
}

function payTo(c: Ctx, y: number, qr: Buffer | null): number {
  const { doc, company } = c;
  text(doc, "Pay To:", M, y, { bold: true });
  const lines = payToLines(company);
  let ly = y + 19;
  for (const l of lines) {
    text(doc, l, M, ly, { width: qr ? COL2 - M : W });
    ly += 11.5;
  }
  let bottom = ly - 2;
  if (qr) {
    try {
      doc.image(qr, M + W - 70, y, { fit: [70, 70] });
      text(doc, "Scan to pay", M + W - 80, y + 72, { width: 90, align: "center", size: 7.5 });
      bottom = Math.max(bottom, y + 84);
    } catch {
      /* QR unavailable → bank details only */
    }
  }
  return bottom;
}

const COLS = { amount: COL2, tax: COL2 + 69, descW: COL2 - M - 24 };

function tableHeader(c: Ctx, y: number): number {
  const { doc } = c;
  text(doc, "Description", M, y);
  if (hasTaxColumns(c.inv)) {
    text(doc, "Amount", COLS.amount, y);
    text(doc, "Tax", COLS.tax, y);
  }
  text(doc, "Total Amount", COL2, y, { width: M + W - COL2, align: "right" });
  rule(doc, y + 15, 1);
  return y + 23;
}

function itemRows(c: Ctx, y: number): number {
  const { doc, inv } = c;
  const taxed = hasTaxColumns(inv);
  const rowDescs = new Set(inv.items.map((i) => i.description.trim()));
  if (inv.description?.trim() && !rowDescs.has(inv.description.trim())) {
    text(doc, inv.description.trim(), M, y, { width: W });
    y += heightOf(doc, inv.description.trim(), W) + 8;
  }
  for (const it of inv.items) {
    const h = heightOf(doc, it.description, COLS.descW);
    if (y + h > ROW_LIMIT_Y) {
      doc.addPage();
      y = tableHeader(c, pageTop(c) + 14);
    }
    text(doc, it.description, M, y, { width: COLS.descW });
    if (taxed) {
      amount(doc, it.amount, c.cur, COLS.amount, y, { width: 66, align: "left", symbolFont: c.sym });
      text(doc, `${pct(inv.gstPercent)}%`, COLS.tax, y);
      amount(doc, round2(it.amount * (1 + inv.gstPercent / 100)), c.cur, COL2, y, { width: M + W - COL2, align: "right", bold: true, symbolFont: c.sym });
    } else {
      amount(doc, it.amount, c.cur, COL2, y, { width: M + W - COL2, align: "right", bold: true, symbolFont: c.sym });
    }
    y += Math.max(h, PT) + 10;
  }
  rule(doc, y + 2, 1);
  return y + 2;
}

/** Place of supply, due date, part label, terms and notes — small block under the table on the left. */
function infoBlock(c: Ctx, y: number): number {
  const { doc, inv, tz } = c;
  const lines: string[] = [];
  if (inv.creditNoteOf) lines.push(`Against invoice ${inv.creditNoteOf}`);
  if (inv.placeOfSupply) lines.push(`Place of supply: ${inv.placeOfSupply}`);
  if (inv.dueDate && inv.docType !== "CREDIT_NOTE") lines.push(`Due date: ${fmtDMY(inv.dueDate, tz)}`);
  if (inv.partLabel) lines.push(`Payment schedule: ${inv.partLabel}`);
  if (inv.paymentTerms && inv.docType !== "CREDIT_NOTE") lines.push(`Terms: ${inv.paymentTerms}`);
  if (inv.notes) lines.push(`Notes: ${inv.notes}`);
  const width = COL2 - M - 30;
  for (const l of lines) {
    text(doc, l, M, y, { width, size: 8 });
    y += heightOf(doc, l, width, { size: 8 }) + 3;
  }
  return y;
}

type TotalLine = { label: string; value?: number; note?: string; bold?: boolean; gapBefore?: number };

function totalLines(c: Ctx): TotalLine[] {
  const { inv, company } = c;
  const out: TotalLine[] = [{ label: "Total amount :", value: inv.subtotal }];
  if (inv.taxMode === "EXPORT_LUT") {
    out.push({ label: "", note: `Supply meant for export under LUT No. ${company.lutNumber || "—"}, without payment of IGST` });
  } else {
    const rows = taxRows(inv);
    for (const [label, value] of rows) out.push({ label, value });
    if (rows.length) out.push({ label: "Total Amount with tax", value: inv.total });
  }
  out.push({ label: inv.docType === "CREDIT_NOTE" ? "Total credit  :" : "Total amount to be paid  :", value: inv.total, bold: true, gapBefore: 50 });
  return out;
}

function totalsBlock(c: Ctx, lines: TotalLine[], top: number): number {
  const { doc } = c;
  let y = top;
  for (const l of lines) {
    y += l.gapBefore ?? 0;
    if (l.note) {
      text(doc, l.note, M, y, { width: W, align: "right" });
    } else {
      text(doc, l.label, COL2, y, { bold: l.bold });
      amount(doc, l.value ?? 0, c.cur, COL2 + 60, y, { width: M + W - COL2 - 60, align: "right", bold: l.bold, symbolFont: c.sym });
    }
    y += 24;
  }
  return y;
}

const blockHeight = (lines: TotalLine[]) => lines.reduce((h, l) => h + 24 + (l.gapBefore ?? 0), 0);

const STAMP_RED = "#dc2626";

/** Big rotated red "CANCELLED" across the page plus the date and reason under the meta line (every page). */
function cancelStamp(c: Ctx): void {
  const { doc, inv, tz } = c;
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc.rotate(-32, { origin: [PAGE_W / 2, PAGE_H / 2] });
    doc.fillColor(STAMP_RED).fillOpacity(0.28).strokeColor(STAMP_RED).strokeOpacity(0.5).lineWidth(4);
    doc.rect(PAGE_W / 2 - 230, PAGE_H / 2 - 62, 460, 124).stroke();
    doc.font("Helvetica-Bold").fontSize(92).text("CANCELLED", PAGE_W / 2 - 230, PAGE_H / 2 - 44, { width: 460, align: "center", lineBreak: false });
    doc.restore();
    const when = inv.cancelledAt ? `Cancelled on ${fmtDMY(inv.cancelledAt, tz)}` : "Cancelled";
    doc.save();
    doc.fillColor(STAMP_RED).fillOpacity(1).font("Helvetica-Bold").fontSize(9);
    const reason = inv.cancelReason ? ` · Reason: ${inv.cancelReason.length > 110 ? `${inv.cancelReason.slice(0, 107)}...` : inv.cancelReason}` : "";
    doc.text(`${when}${reason}`, M, 40, { width: W, align: "right", lineBreak: false });
    doc.restore();
  }
}

export async function renderInvoicePdf(inv: PdfInvoice, client: PdfParty, company: PdfCompany): Promise<Buffer> {
  if (inv.docType === "EXPORT_INVOICE" && !company.lutNumber?.trim()) throw new Error("Export invoices need the LUT number — add it in Settings → Company");
  const title = documentTitle(inv);
  const qr = await qrFor(inv, company);
  const cancelled = inv.status === "CANCELLED";
  const doc = new PDFDocument({ size: "A4", margins: { top: M, left: M, right: M, bottom: 0 }, bufferPages: cancelled, info: { Title: `${title} ${inv.number}${cancelled ? " (cancelled)" : ""}`, Author: company.companyName } });
  const out = collect(doc);
  const c: Ctx = { doc, inv, company, cur: (inv.currency || "INR").toUpperCase(), sym: registerFonts(doc), title, tz: company.timezone || "Asia/Kolkata", now: new Date() };

  let y = pageTop(c) + 21;
  y = partyColumns(doc, y, { label: inv.docType === "CREDIT_NOTE" ? "Credit To:" : "Invoice To:", lines: partyLines(client) }, { label: "Invoice From:", lines: companyLines(company) });
  rule(doc, y + 10);
  y = payTo(c, y + 23, qr);
  rule(doc, y + 8);
  y = tableHeader(c, y + 22);
  y = itemRows(c, y);
  const infoBottom = infoBlock(c, y + 14);

  const lines = totalLines(c);
  const needed = blockHeight(lines);
  let top = Math.max(y + 16, TOTAL_ANCHOR_Y + 24 - needed, infoBottom + 70 - needed);
  if (top + needed > FOOTER_Y - 8) {
    footer(doc, company, c.now);
    doc.addPage();
    top = pageTop(c) + 30;
  }
  const bottom = totalsBlock(c, lines, top);
  signatureBlock(doc, company, bottom - 24);
  footer(doc, company, c.now);
  if (cancelled) cancelStamp(c);
  doc.end();
  return out;
}
