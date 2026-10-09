import PDFDocument from "pdfkit";
import { formatINRPlain } from "@/server/finance/money";
import { upiQrPng } from "@/server/finance/qr";
import type { DocType, TaxMode } from "@/server/finance/tax";

/**
 * Server-side invoice / receipt PDFs (SPEC §11.3, ADR 0005): GST-compliant template with company logo,
 * HSN/SAC column, CGST/SGST/IGST split, place of supply, bank details, UPI QR and terms. Returns a Buffer.
 * Standard PDF fonts have no ₹ glyph, so amounts are printed as "INR 1,23,456.00".
 */
export type PdfCompany = {
  companyName: string;
  address: string;
  gstNumber: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankIfsc: string;
  upiId: string;
  lutNumber?: string | null;
  logoData?: Uint8Array | Buffer | null;
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

export type PdfInvoice = {
  number: string;
  issuedAt: Date;
  dueDate?: Date | null;
  docType?: DocType;
  taxMode?: TaxMode;
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
};

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
};

const PAGE_W = 595.28; // A4 points
const M = 40;
const W = PAGE_W - 2 * M;
const GREY = "#6b7280";
const DARK = "#111827";
const BRAND = "#174ea6";

function fmtDate(d: Date) {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function collect(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

export function documentTitle(inv: Pick<PdfInvoice, "docType" | "creditNoteOf">, company: Pick<PdfCompany, "lutNumber">): { title: string; subtitle: string | null } {
  switch (inv.docType) {
    case "EXPORT_INVOICE":
      return { title: "EXPORT INVOICE", subtitle: `Supply meant for export under LUT No. ${company.lutNumber || "—"}, without payment of IGST` };
    case "PROFORMA":
      return { title: "PROFORMA INVOICE", subtitle: "Not a tax invoice — for approval / advance payment" };
    case "CREDIT_NOTE":
      return { title: "CREDIT NOTE", subtitle: inv.creditNoteOf ? `Against invoice ${inv.creditNoteOf}` : null };
    default:
      return { title: "TAX INVOICE", subtitle: null };
  }
}

function header(doc: PDFKit.PDFDocument, company: PdfCompany, title: string, subtitle: string | null, meta: [string, string][]) {
  let y = M;
  if (company.logoData && company.logoData.length > 0) {
    try {
      doc.image(Buffer.from(company.logoData), M, y, { fit: [110, 50] });
      y += 56;
    } catch {
      /* unsupported image → skip logo */
    }
  }
  doc.fillColor(DARK).font("Helvetica-Bold").fontSize(16).text(company.companyName, M, y, { width: W / 2 });
  doc.font("Helvetica").fontSize(9).fillColor(GREY);
  if (company.address) doc.text(company.address, { width: W / 2 });
  if (company.gstNumber) doc.text(`GSTIN: ${company.gstNumber}`, { width: W / 2 });
  const leftBottom = doc.y;

  doc.fillColor(BRAND).font("Helvetica-Bold").fontSize(20).text(title, M + W / 2, M, { width: W / 2, align: "right" });
  let my = doc.y + 4;
  if (subtitle) {
    doc.font("Helvetica").fontSize(8).fillColor(GREY).text(subtitle, M + W / 2 - 40, my, { width: W / 2 + 40, align: "right" });
    my = doc.y + 4;
  }
  doc.font("Helvetica").fontSize(9).fillColor(DARK);
  for (const [k, v] of meta) {
    doc.text(`${k}: ${v}`, M + W / 2, my, { width: W / 2, align: "right" });
    my += 13;
  }
  const bottom = Math.max(leftBottom, my) + 12;
  doc.moveTo(M, bottom).lineTo(M + W, bottom).lineWidth(1).strokeColor("#e5e7eb").stroke();
  doc.y = bottom + 12;
}

function party(doc: PDFKit.PDFDocument, label: string, p: PdfParty) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text(label, M, doc.y);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(DARK).text(p.businessName?.trim() || p.name, { width: W });
  doc.font("Helvetica").fontSize(9).fillColor(DARK);
  if (p.address) doc.text(p.address, { width: W });
  if (p.gstNumber) doc.text(`GSTIN: ${p.gstNumber}`);
  if (p.pan) doc.text(`PAN: ${p.pan}`);
  const contact = [p.phone, p.email].filter(Boolean).join(" · ");
  if (contact) doc.text(contact);
  doc.moveDown(0.8);
}

function paragraph(doc: PDFKit.PDFDocument, label: string, text: string | null | undefined) {
  if (!text) return;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text(label, M, doc.y);
  doc.font("Helvetica").fontSize(9).fillColor(DARK).text(text, { width: W });
  doc.moveDown(0.8);
}

const COLS = [
  { key: "idx", label: "#", w: 22, align: "left" },
  { key: "description", label: "Description", w: 205, align: "left" },
  { key: "hsnSac", label: "HSN/SAC", w: 60, align: "left" },
  { key: "qty", label: "Qty", w: 45, align: "right" },
  { key: "unit", label: "Unit", w: 45, align: "left" },
  { key: "rate", label: "Rate", w: 68, align: "right" },
  { key: "amount", label: "Amount", w: 70, align: "right" },
] as const;

function itemsTable(doc: PDFKit.PDFDocument, inv: PdfInvoice) {
  let y = doc.y;
  doc.rect(M, y, W, 18).fill("#f3f4f6");
  doc.font("Helvetica-Bold").fontSize(8).fillColor(DARK);
  let x = M + 4;
  for (const c of COLS) {
    doc.text(c.label, x, y + 5, { width: c.w - 8, align: c.align });
    x += c.w;
  }
  y += 18;
  doc.font("Helvetica").fontSize(9);
  inv.items.forEach((it, i) => {
    const cells: Record<(typeof COLS)[number]["key"], string> = {
      idx: String(i + 1),
      description: it.description,
      hsnSac: it.hsnSac ?? "",
      qty: it.unit === "HOURS" ? String(it.qty) : "1",
      unit: it.unit === "HOURS" ? "Hrs" : "Fixed",
      rate: formatINRPlain(it.rate).replace("INR ", ""),
      amount: formatINRPlain(it.amount).replace("INR ", ""),
    };
    const h = Math.max(16, doc.heightOfString(cells.description, { width: COLS[1].w - 8 }) + 6);
    if (y + h > 760) {
      doc.addPage();
      y = M;
    }
    x = M + 4;
    for (const c of COLS) {
      doc.text(cells[c.key], x, y + 3, { width: c.w - 8, align: c.align });
      x += c.w;
    }
    y += h;
    doc.moveTo(M, y).lineTo(M + W, y).lineWidth(0.5).strokeColor("#e5e7eb").stroke();
  });
  doc.y = y + 8;
}

function totals(doc: PDFKit.PDFDocument, rows: [string, string, boolean?][]) {
  const x = M + W - 240;
  let y = doc.y;
  for (const [k, v, bold] of rows) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor(DARK);
    doc.text(k, x, y, { width: 120, align: "right" });
    doc.text(v, x + 124, y, { width: 116, align: "right" });
    y += bold ? 18 : 14;
  }
  doc.y = y + 10;
}

/** Tax lines per mode (ADR 0005): CGST+SGST halves, IGST, or a zero-rated / no-tax line. */
export function taxRows(inv: PdfInvoice): [string, string][] {
  const half = inv.gstPercent / 2;
  const pct = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
  switch (inv.taxMode) {
    case "IGST":
      return [[`IGST @ ${pct(inv.gstPercent)}%`, formatINRPlain(inv.igstAmount ?? inv.gstAmount)]];
    case "EXPORT_LUT":
      return [["IGST @ 0% (export under LUT)", formatINRPlain(0)]];
    case "NONE":
      return [["GST", "Not applicable"]];
    case "CGST_SGST":
      return [
        [`CGST @ ${pct(half)}%`, formatINRPlain(inv.cgstAmount ?? inv.gstAmount / 2)],
        [`SGST @ ${pct(half)}%`, formatINRPlain(inv.sgstAmount ?? inv.gstAmount / 2)],
      ];
    default:
      return [[`GST @ ${pct(inv.gstPercent)}%`, formatINRPlain(inv.gstAmount)]];
  }
}

function bankLines(company: PdfCompany): string[] {
  return [
    company.bankName && `Bank: ${company.bankName}`,
    company.bankAccountName && `Account name: ${company.bankAccountName}`,
    company.bankAccountNumber && `Account no: ${company.bankAccountNumber}`,
    company.bankIfsc && `IFSC: ${company.bankIfsc}`,
    company.upiId && `UPI: ${company.upiId}`,
  ].filter(Boolean) as string[];
}

function footerBlocks(doc: PDFKit.PDFDocument, company: PdfCompany, blocks: [string, string | null | undefined][], qr?: Buffer | null) {
  const bank = bankLines(company);
  if (bank.length) {
    const top = doc.y;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text("Bank details", M, top);
    doc.font("Helvetica").fontSize(9).fillColor(DARK).text(bank.join("\n"), { width: W - 130 });
    let bottom = doc.y;
    if (qr) {
      try {
        doc.image(qr, M + W - 100, top, { fit: [90, 90] });
        doc.font("Helvetica").fontSize(7).fillColor(GREY).text("Scan to pay (UPI)", M + W - 110, top + 92, { width: 110, align: "center" });
        bottom = Math.max(bottom, top + 104);
      } catch {
        /* QR unavailable → bank details only */
      }
    }
    doc.y = bottom;
    doc.moveDown(0.6);
  }
  for (const [k, v] of blocks) {
    if (!v) continue;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text(k, M, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor(DARK).text(v, { width: W });
    doc.moveDown(0.6);
  }
  doc.font("Helvetica").fontSize(8).fillColor(GREY).text("This is a computer-generated document and does not require a signature.", M, 800, {
    width: W,
    align: "center",
  });
}

async function qrFor(inv: PdfInvoice, company: PdfCompany): Promise<Buffer | null> {
  if (!company.upiId || inv.docType === "CREDIT_NOTE" || inv.total <= 0) return null;
  try {
    return await upiQrPng({ upiId: company.upiId, payeeName: company.companyName, amount: inv.total, note: inv.number });
  } catch {
    return null;
  }
}

export async function renderInvoicePdf(inv: PdfInvoice, client: PdfParty, company: PdfCompany): Promise<Buffer> {
  const { title, subtitle } = documentTitle(inv, company);
  const qr = await qrFor(inv, company);
  const doc = new PDFDocument({ size: "A4", margin: M, info: { Title: `${title} ${inv.number}`, Author: company.companyName } });
  const out = collect(doc);
  const label = inv.docType === "CREDIT_NOTE" ? "Credit note no" : inv.docType === "PROFORMA" ? "Proforma no" : "Invoice no";
  const meta: [string, string][] = [
    [label, inv.number],
    ["Date", fmtDate(inv.issuedAt)],
  ];
  if (inv.dueDate && inv.docType !== "CREDIT_NOTE") meta.push(["Due date", fmtDate(inv.dueDate)]);
  if (inv.placeOfSupply) meta.push(["Place of supply", inv.placeOfSupply]);
  if (inv.partLabel) meta.push(["Payment schedule", inv.partLabel]);
  header(doc, company, title, subtitle, meta);
  party(doc, inv.docType === "CREDIT_NOTE" ? "ISSUED TO" : "BILL TO", client);
  paragraph(doc, "DESCRIPTION", inv.description);
  itemsTable(doc, inv);
  totals(doc, [["Subtotal", formatINRPlain(inv.subtotal)], ...taxRows(inv), ["Total", formatINRPlain(inv.total), true]]);
  footerBlocks(
    doc,
    company,
    [
      ["Payment terms", inv.docType === "CREDIT_NOTE" ? null : inv.paymentTerms],
      ["Notes", inv.notes],
    ],
    qr,
  );
  doc.end();
  return out;
}

export async function renderReceiptPdf(r: PdfReceipt, client: PdfParty, company: PdfCompany): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: M, info: { Title: `Receipt ${r.receiptNumber}`, Author: company.companyName } });
  const out = collect(doc);
  header(doc, company, "PAYMENT RECEIPT", null, [
    ["Receipt no", r.receiptNumber],
    ["Date", fmtDate(r.receivedAt)],
    ["Against invoice", r.invoiceNumber],
  ]);
  party(doc, "RECEIVED FROM", client);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text("PAYMENT DETAILS", M, doc.y);
  doc.font("Helvetica").fontSize(9).fillColor(DARK);
  doc.text(`Method: ${r.method}`);
  if (r.reference) doc.text(`Reference: ${r.reference}`);
  if (r.notes) doc.text(`Notes: ${r.notes}`);
  doc.moveDown(0.8);
  const tds = r.tdsAmount ?? 0;
  const rows: [string, string, boolean?][] = [
    ["Invoice total", formatINRPlain(r.invoiceTotal)],
    ["Amount received", formatINRPlain(r.amount), true],
  ];
  if (tds > 0) rows.push(["TDS deducted", formatINRPlain(tds)]);
  rows.push(["Total settled to date", formatINRPlain(r.totalReceived)]);
  rows.push(["Balance outstanding", formatINRPlain(r.balance ?? Math.max(0, r.invoiceTotal - r.totalReceived))]);
  totals(doc, rows);
  doc.font("Helvetica").fontSize(10).fillColor(DARK).text(`Thank you for your payment.`, M, doc.y);
  doc.moveDown(1);
  footerBlocks(doc, company, []);
  doc.end();
  return out;
}
