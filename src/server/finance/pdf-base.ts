import fs from "fs";
import path from "path";
import { formatInTimeZone } from "date-fns-tz";
import { formatCurrency } from "@/server/finance/money";

/**
 * Shared plumbing for the owner's invoice template (ADR 0007): A4 portrait, Helvetica 9pt, thin dark rules,
 * generous whitespace. Body text uses the standard Helvetica fonts (they match the Arial of the reference);
 * the ₹ glyph comes from DejaVu Sans, which ships in src/server/finance/fonts (Bitstream Vera licence).
 */
export const PAGE_W = 595.28;
export const PAGE_H = 841.89;
export const M = 22;
export const W = PAGE_W - 2 * M;
export const INK = "#111111";
export const RULE = "#222222";
export const FONT = "Helvetica";
export const BOLD = "Helvetica-Bold";
export const SYM = "DejaVu";
export const SYM_BOLD = "DejaVu-Bold";
export const PT = 9;
/** Right column (Invoice From / totals) starts here, as in the reference. */
export const COL2 = M + 344;
export const FOOTER_Y = 815;

const FONT_DIR = path.join(process.cwd(), "src/server/finance/fonts");
const FONT_FILES = { [SYM]: "DejaVuSans.ttf", [SYM_BOLD]: "DejaVuSans-Bold.ttf" } as const;

export type Doc = PDFKit.PDFDocument;

export type PdfCompany = {
  companyName: string;
  /** Legal name printed in "Invoice From" (falls back to companyName). */
  legalName?: string | null;
  address: string;
  gstNumber: string;
  pan?: string | null;
  iecCode?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  hsnSacCode?: string | null;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankSwift?: string | null;
  bankAddress?: string | null;
  upiId: string;
  lutNumber?: string | null;
  logoData?: Uint8Array | Buffer | null;
  signatureData?: Uint8Array | Buffer | null;
  timezone?: string | null;
};

export type PdfParty = {
  name: string;
  /** Legal name printed in the bill-to block (ADR 0006); `name` is the display name and the fallback. */
  businessName?: string | null;
  pan?: string | null;
  address?: string | null;
  gstNumber?: string | null;
  email?: string | null;
  phone?: string | null;
};

export function collect(doc: Doc): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/** Registers DejaVu Sans (₹ glyph). Returns false when the files are missing so amounts fall back to "Rs ". */
export function registerFonts(doc: Doc): boolean {
  let ok = true;
  for (const [name, file] of Object.entries(FONT_FILES)) {
    const p = path.join(FONT_DIR, file);
    if (!fs.existsSync(p)) {
      ok = false;
      continue;
    }
    doc.registerFont(name, p);
  }
  return ok;
}

export const fmtDMY = (d: Date, tz: string) => formatInTimeZone(d, tz, "dd/MM/yyyy");

/** "3:32 pm IST" in the company timezone. */
export function fmtClock(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone: tz, timeZoneName: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", timeZoneName: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
  }
}

export function text(doc: Doc, s: string, x: number, y: number, o: { bold?: boolean; size?: number; width?: number; align?: "left" | "right" | "center" } = {}) {
  doc.font(o.bold ? BOLD : FONT).fontSize(o.size ?? PT).fillColor(INK);
  doc.text(s, x, y, { width: o.width, align: o.align ?? "left", lineBreak: o.width != null, lineGap: 1.5 });
}

/** Height of a (possibly wrapped) string at the body size. */
export function heightOf(doc: Doc, s: string, width: number, o: { bold?: boolean; size?: number } = {}): number {
  doc.font(o.bold ? BOLD : FONT).fontSize(o.size ?? PT);
  return doc.heightOfString(s, { width, lineGap: 1.5 });
}

export function rule(doc: Doc, y: number, width = 1.5) {
  doc.moveTo(M, y).lineTo(M + W, y).lineWidth(width).strokeColor(RULE).stroke();
}

type FontPrivate = { _font: { ascender: number } };
const ascender = (doc: Doc) => (doc as unknown as FontPrivate)._font.ascender / 1000;

/**
 * Draws a formatted amount: the ₹ symbol in DejaVu (baseline-aligned), the digits in Helvetica so they match the
 * rest of the page. Foreign currencies print their code before the number ("AED2,700").
 */
export function amount(doc: Doc, n: number, currency: string, x: number, y: number, o: { width: number; align: "left" | "right"; bold?: boolean; size?: number; symbolFont?: boolean }) {
  const size = o.size ?? PT;
  const s = formatCurrency(n, currency);
  const body = o.bold ? BOLD : FONT;
  if (!s.startsWith("₹") || o.symbolFont === false) {
    text(doc, s.replace("₹", "Rs "), x, y, { bold: o.bold, size, width: o.width, align: o.align });
    return;
  }
  const digits = s.slice(1);
  doc.font(o.bold ? SYM_BOLD : SYM).fontSize(size);
  const symW = doc.widthOfString("₹");
  const symAsc = ascender(doc);
  doc.font(body).fontSize(size);
  const numW = doc.widthOfString(digits);
  const bodyAsc = ascender(doc);
  const start = o.align === "right" ? x + o.width - symW - numW : x;
  doc.font(o.bold ? SYM_BOLD : SYM).fontSize(size).fillColor(INK).text("₹", start, y - (symAsc - bodyAsc) * size, { lineBreak: false });
  doc.font(body).fontSize(size).fillColor(INK).text(digits, start + symW, y, { lineBreak: false });
}

/** Top-right meta line ("Invoice No. 45  08/10/2026"). */
export function metaLine(doc: Doc, s: string) {
  text(doc, s, M, 27, { width: W, align: "right" });
}

/** Logo + brand name on the left, document title on the right. Returns the y below the row. */
export function titleRow(doc: Doc, company: PdfCompany, title: string, y = 57): number {
  let nameX = M;
  let drewLogo = false;
  if (company.logoData && company.logoData.length > 0) {
    try {
      doc.image(Buffer.from(company.logoData), M, y, { fit: [60, 60] });
      nameX = M + 66;
      drewLogo = true;
    } catch {
      /* unsupported image → no logo */
    }
  }
  const textY = drewLogo ? y + 22 : y + 4;
  text(doc, company.companyName, nameX, textY, { bold: true, size: 14.5 });
  text(doc, title, COL2, textY, { bold: true, size: 14.5, width: M + W - COL2, align: "right" });
  return drewLogo ? y + 60 : y + 28;
}

/** Website left, HSN/SAC centre, generation time right. */
export function footer(doc: Doc, company: PdfCompany, now: Date) {
  const tz = company.timezone || "Asia/Kolkata";
  const third = W / 3;
  if (company.website) text(doc, company.website, M, FOOTER_Y, { width: third });
  if (company.hsnSacCode) text(doc, `HSN Code - ${company.hsnSacCode}`, M + third, FOOTER_Y, { width: third, align: "center" });
  text(doc, fmtClock(now, tz), M + 2 * third, FOOTER_Y, { width: third, align: "right" });
}

/** Bill-to lines in the reference order (empty ones omitted, blank line after the name). */
export function partyLines(p: PdfParty): string[] {
  const out = [p.businessName?.trim() || p.name, ""];
  for (const v of [p.address, p.email, p.phone, p.gstNumber, p.pan]) if (v?.trim()) out.push(v.trim());
  return out;
}

/** "Invoice From" lines: legal name, address, email, phone, GST No., PAN / IEC, LUT (when set). */
export function companyLines(c: PdfCompany): string[] {
  const out = [c.legalName?.trim() || c.companyName, ""];
  for (const v of [c.address, c.email, c.phone]) if (v?.trim()) out.push(v.trim());
  if (c.gstNumber) out.push(`GST No. - ${c.gstNumber}`);
  const panIec = [c.pan, c.iecCode].map((v) => v?.trim()).filter(Boolean);
  if (panIec.length) out.push(`PAN No. / IEC Code - ${Array.from(new Set(panIec)).join(" / ")}`);
  if (c.lutNumber?.trim()) out.push(`LUT No. ${c.lutNumber.trim()}`);
  return out;
}

export function payToLines(c: PdfCompany): string[] {
  return [
    c.bankAccountName && `Account Name : ${c.bankAccountName}`,
    c.bankAccountNumber && `Account Number : ${c.bankAccountNumber}`,
    c.bankSwift && `Swift Code / BIC Code : ${c.bankSwift}`,
    c.bankIfsc && `IFSC Code : ${c.bankIfsc}`,
    c.bankName && `Bank Name : ${c.bankName}`,
    c.bankAddress && `Bank Address : ${c.bankAddress}`,
  ].filter(Boolean) as string[];
}

/** Draws lines one under the other (wrapping inside `width`); `gap` is the extra space between lines. */
export function stack(doc: Doc, lines: string[], x: number, y: number, o: { width: number; gap?: number; bold?: boolean }): number {
  const gap = o.gap ?? 7;
  for (const line of lines) {
    if (line === "") {
      y += PT;
      continue;
    }
    text(doc, line, x, y, { width: o.width, bold: o.bold });
    y += heightOf(doc, line, o.width, { bold: o.bold }) + gap;
  }
  return y;
}

/** "Invoice To:" / "Invoice From:" two-column block; returns the y under the taller column. */
export function partyColumns(doc: Doc, y: number, left: { label: string; lines: string[] }, right: { label: string; lines: string[] }): number {
  text(doc, left.label, M, y, { bold: true });
  text(doc, right.label, COL2, y, { bold: true });
  const top = y + 19;
  const leftBottom = stack(doc, left.lines, M, top, { width: COL2 - M - 20 });
  const rightBottom = stack(doc, right.lines, COL2, top, { width: M + W - COL2 });
  return Math.max(leftBottom, rightBottom);
}

/** Signature image (≈210pt wide) with "Signature" centred below; `baseline` is the caption's y. */
export function signatureBlock(doc: Doc, company: PdfCompany, baseline: number) {
  const width = 210;
  if (company.signatureData && company.signatureData.length > 0) {
    try {
      const h = 65;
      doc.image(Buffer.from(company.signatureData), M + 2, baseline - h - 6, { fit: [width, h], align: "center", valign: "bottom" });
      text(doc, "Signature", M + 2, baseline, { width, align: "center", size: 11 });
      return;
    } catch {
      /* unsupported image → text signatory */
    }
  }
  text(doc, company.legalName?.trim() || company.companyName, M + 2, baseline - 14, { width, align: "center", bold: true });
  text(doc, "Authorised signatory", M + 2, baseline, { width, align: "center" });
}
