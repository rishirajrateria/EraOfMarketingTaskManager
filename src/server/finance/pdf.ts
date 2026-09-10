import PDFDocument from "pdfkit";
import { formatINRPlain } from "@/server/finance/money";

/**
 * Server-side invoice / receipt PDFs (SPEC §11.3): clean GST-compliant template with company logo,
 * HSN/SAC column, INR totals, bank details and terms. Returns a Buffer (starts with %PDF).
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
  logoData?: Uint8Array | Buffer | null;
};

export type PdfParty = { name: string; address?: string | null; gstNumber?: string | null; email?: string | null };

export type PdfInvoice = {
  number: string;
  issuedAt: Date;
  dueDate?: Date | null;
  items: { description: string; hsnSac?: string | null; qty: number; unit: "HOURS" | "FIXED"; rate: number; amount: number }[];
  subtotal: number;
  gstPercent: number;
  gstAmount: number;
  total: number;
  notes?: string | null;
  paymentTerms?: string | null;
  status?: string;
};

export type PdfReceipt = {
  receiptNumber: string;
  receivedAt: Date;
  amount: number;
  method: string;
  reference?: string | null;
  invoiceNumber: string;
  invoiceTotal: number;
  totalReceived: number;
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

function header(doc: PDFKit.PDFDocument, company: PdfCompany, title: string, meta: [string, string][]) {
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
  doc.font("Helvetica-Bold").fontSize(11).fillColor(DARK).text(p.name, { width: W });
  doc.font("Helvetica").fontSize(9).fillColor(DARK);
  if (p.address) doc.text(p.address, { width: W });
  if (p.gstNumber) doc.text(`GSTIN: ${p.gstNumber}`);
  if (p.email) doc.text(p.email);
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

function footerBlocks(doc: PDFKit.PDFDocument, company: PdfCompany, blocks: [string, string | null | undefined][]) {
  const bank = [
    company.bankName && `Bank: ${company.bankName}`,
    company.bankAccountName && `Account name: ${company.bankAccountName}`,
    company.bankAccountNumber && `Account no: ${company.bankAccountNumber}`,
    company.bankIfsc && `IFSC: ${company.bankIfsc}`,
    company.upiId && `UPI: ${company.upiId}`,
  ].filter(Boolean) as string[];
  const all: [string, string][] = [];
  if (bank.length) all.push(["Bank details", bank.join("\n")]);
  for (const [k, v] of blocks) if (v) all.push([k, v]);
  for (const [k, v] of all) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text(k, M, doc.y);
    doc.font("Helvetica").fontSize(9).fillColor(DARK).text(v, { width: W });
    doc.moveDown(0.6);
  }
  doc.font("Helvetica").fontSize(8).fillColor(GREY).text("This is a computer-generated document and does not require a signature.", M, 800, {
    width: W,
    align: "center",
  });
}

export async function renderInvoicePdf(inv: PdfInvoice, client: PdfParty, company: PdfCompany): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: M, info: { Title: `Invoice ${inv.number}`, Author: company.companyName } });
  const out = collect(doc);
  const meta: [string, string][] = [
    ["Invoice no", inv.number],
    ["Date", fmtDate(inv.issuedAt)],
  ];
  if (inv.dueDate) meta.push(["Due date", fmtDate(inv.dueDate)]);
  header(doc, company, "TAX INVOICE", meta);
  party(doc, "BILL TO", client);
  itemsTable(doc, inv);
  totals(doc, [
    ["Subtotal", formatINRPlain(inv.subtotal)],
    [`GST @ ${inv.gstPercent}%`, formatINRPlain(inv.gstAmount)],
    ["Total", formatINRPlain(inv.total), true],
  ]);
  footerBlocks(doc, company, [
    ["Payment terms", inv.paymentTerms],
    ["Notes", inv.notes],
  ]);
  doc.end();
  return out;
}

export async function renderReceiptPdf(r: PdfReceipt, client: PdfParty, company: PdfCompany): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: M, info: { Title: `Receipt ${r.receiptNumber}`, Author: company.companyName } });
  const out = collect(doc);
  header(doc, company, "PAYMENT RECEIPT", [
    ["Receipt no", r.receiptNumber],
    ["Date", fmtDate(r.receivedAt)],
    ["Against invoice", r.invoiceNumber],
  ]);
  party(doc, "RECEIVED FROM", client);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(GREY).text("PAYMENT DETAILS", M, doc.y);
  doc.font("Helvetica").fontSize(9).fillColor(DARK);
  doc.text(`Method: ${r.method}`);
  if (r.reference) doc.text(`Reference: ${r.reference}`);
  doc.moveDown(0.8);
  totals(doc, [
    ["Invoice total", formatINRPlain(r.invoiceTotal)],
    ["Amount received", formatINRPlain(r.amount), true],
    ["Total received to date", formatINRPlain(r.totalReceived)],
    ["Balance outstanding", formatINRPlain(Math.max(0, r.invoiceTotal - r.totalReceived))],
  ]);
  doc.font("Helvetica").fontSize(10).fillColor(DARK).text(`Thank you for your payment.`, M, doc.y);
  doc.moveDown(1);
  footerBlocks(doc, company, []);
  doc.end();
  return out;
}
