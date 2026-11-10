import PDFDocument from "pdfkit";
import { COL2, M, W, amount, collect, companyLines, fmtDMY, footer, metaLine, partyColumns, partyLines, registerFonts, rule, signatureBlock, text, titleRow, type PdfCompany, type PdfParty } from "@/server/finance/pdf-base";

/** Payment receipt PDF: same header / footer / fonts as the invoice template (ADR 0007), receipt body kept. */
export type PdfReceipt = {
  receiptNumber: string;
  receivedAt: Date;
  amount: number;
  tdsAmount?: number;
  method: string;
  reference?: string | null;
  notes?: string | null;
  invoiceNumber: string;
  invoiceTotal: number;
  totalReceived: number;
  /** Outstanding after payments, TDS and credit notes; defaults to invoiceTotal − totalReceived. */
  balance?: number;
  /** ISO 4217 of the invoice (default INR). */
  currency?: string | null;
};

export async function renderReceiptPdf(r: PdfReceipt, client: PdfParty, company: PdfCompany): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margins: { top: M, left: M, right: M, bottom: 0 }, info: { Title: `Receipt ${r.receiptNumber}`, Author: company.companyName } });
  const out = collect(doc);
  const sym = registerFonts(doc);
  const cur = (r.currency || "INR").toUpperCase();
  const tz = company.timezone || "Asia/Kolkata";
  const now = new Date();

  metaLine(doc, `Receipt No. ${r.receiptNumber}  ${fmtDMY(r.receivedAt, tz)}`);
  let y = titleRow(doc, company, "Payment Receipt") + 21;
  y = partyColumns(doc, y, { label: "Received From:", lines: partyLines(client) }, { label: "Invoice From:", lines: companyLines(company) });
  rule(doc, y + 10);
  y += 23;
  text(doc, "Payment Details:", M, y, { bold: true });
  const details = [`Against invoice : ${r.invoiceNumber}`, `Method : ${r.method}`, r.reference ? `Reference : ${r.reference}` : "", r.notes ? `Notes : ${r.notes}` : ""].filter(Boolean);
  let ly = y + 19;
  for (const d of details) {
    text(doc, d, M, ly, { width: W });
    ly += 11.5;
  }
  rule(doc, ly + 6);
  y = ly + 22;

  const tds = r.tdsAmount ?? 0;
  const rows: { label: string; value: number; bold?: boolean }[] = [
    { label: "Invoice total :", value: r.invoiceTotal },
    { label: "Amount received :", value: r.amount, bold: true },
  ];
  if (tds > 0) rows.push({ label: "TDS deducted by client :", value: tds });
  rows.push({ label: "Total settled to date :", value: r.totalReceived });
  rows.push({ label: "Balance outstanding :", value: r.balance ?? Math.max(0, r.invoiceTotal - r.totalReceived), bold: true });
  for (const row of rows) {
    text(doc, row.label, COL2, y, { bold: row.bold });
    amount(doc, row.value, cur, COL2 + 60, y, { width: M + W - COL2 - 60, align: "right", bold: row.bold, symbolFont: sym });
    y += 24;
  }
  text(doc, "Thank you for your payment.", M, y + 6, { size: 10 });
  signatureBlock(doc, company, Math.max(y + 110, 773));
  footer(doc, company, now);
  doc.end();
  return out;
}
