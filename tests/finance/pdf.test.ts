import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { documentTitle, metaText, renderInvoicePdf, renderReceiptPdf, taxRows, type PdfCompany, type PdfInvoice, type PdfParty } from "@/server/finance/pdf";
import { fmtClock } from "@/server/finance/pdf-base";
import { upiPayUrl, upiQrPng } from "@/server/finance/qr";
import { computeTotals, formatCurrency, formatINR, formatINRPlain, formatMoney, lineAmount, toCsv } from "@/server/finance/money";
import { pdfText } from "../helpers/pdf-text";

const asset = (f: string) => readFileSync(path.join(process.cwd(), "prisma/seed-assets", f));
/** pdf-parse joins items on one line without spaces, so layout assertions compare whitespace-free strings. */
const squash = (s: string) => s.replace(/\s+/g, "");
const has = (text: string, s: string) => expect(squash(text)).toContain(squash(s));
const hasNot = (text: string, s: string) => expect(squash(text)).not.toContain(squash(s));

/** The owner's company block (same values as prisma/seed.ts). */
const company: PdfCompany = {
  companyName: "The Era Of Marketing",
  legalName: "The Era Of Marketing",
  address: "7th floor, Yamuna Building, 86 Golaghata Rd, Kolkata, West Bengal 700048, India",
  gstNumber: "19CEWPR5040D1Z3",
  pan: "CEWPR5040D",
  iecCode: "CEWPR5040D",
  lutNumber: "AD190424009251F",
  email: "contact@theeraofmarketing.com",
  phone: "918910358506",
  website: "www.theeraofmarketing.com",
  hsnSacCode: "998361",
  bankName: "IDFC FIRST Bank LTD",
  bankAccountName: "The Era Of Marketing",
  bankAccountNumber: "10126079826",
  bankIfsc: "IDFB0060102",
  bankSwift: "IDFBINBBMUM",
  bankAddress: "Salt Lake, Sector 1, Kolkata, West Bengal, India, Pincode 700064",
  upiId: "",
  timezone: "Asia/Kolkata",
  logoData: asset("logo.png"),
  signatureData: asset("signature.png"),
};

const client: PdfParty = { name: "Jaiswal", businessName: "JAISWAL PHARMA", address: "13A/4 ARRIF ROAD, GROUND FLOOR,\nMuchi bazar, Kolkata 700067", email: "jaiswalpharma.jp@gmail.com", phone: "+919830222674", gstNumber: "19ARZPG5262C1ZG", pan: "ARZPG5262C" };

const invoice: PdfInvoice = {
  number: "EOM/26-27/0045",
  issuedAt: new Date("2026-10-08T06:00:00Z"),
  dueDate: new Date("2026-10-23T06:00:00Z"),
  docType: "TAX_INVOICE",
  taxMode: "CGST_SGST",
  placeOfSupply: "19 - West Bengal",
  description: "SEO",
  items: [{ description: "SEO", qty: 1, unit: "FIXED", rate: 30000, amount: 30000 }],
  subtotal: 30000,
  gstPercent: 18,
  gstAmount: 5400,
  cgstAmount: 2700,
  sgstAmount: 2700,
  igstAmount: 0,
  total: 35400,
  paymentTerms: "Payment due within 15 days.",
};

describe("invoice PDF template (ADR 0007)", () => {
  it("tax invoice: meta line, both party blocks, Pay To, 4-column table, CGST/SGST totals, footer", async () => {
    const buf = await renderInvoicePdf(invoice, client, company);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    const { text, pages } = await pdfText(buf);
    expect(pages).toBe(1);
    has(text, "Invoice No. EOM/26-27/0045 08/10/2026");
    has(text, "The Era Of Marketing Tax Invoice");
    has(text, "Invoice To: Invoice From:");
    for (const s of ["JAISWAL PHARMA", "jaiswalpharma.jp@gmail.com", "+919830222674", "19ARZPG5262C1ZG", "ARZPG5262C"]) has(text, s);
    for (const s of ["GST No. - 19CEWPR5040D1Z3", "PAN No. / IEC Code - CEWPR5040D", "LUT No. AD190424009251F", "contact@theeraofmarketing.com"]) has(text, s);
    for (const s of ["Pay To:", "Account Name : The Era Of Marketing", "Account Number : 10126079826", "Swift Code / BIC Code : IDFBINBBMUM", "IFSC Code : IDFB0060102", "Bank Name : IDFC FIRST Bank LTD", "Bank Address : Salt Lake, Sector 1"]) has(text, s);
    has(text, "Description Amount Tax Total Amount");
    has(text, "SEO ₹30,000 18% ₹35,400");
    has(text, "Total amount : ₹30,000");
    has(text, "CGST 9% ₹2,700");
    has(text, "SGST 9% ₹2,700");
    has(text, "Total Amount with tax ₹35,400");
    has(text, "Total amount to be paid : ₹35,400");
    has(text, "Signature");
    has(text, "www.theeraofmarketing.com HSN Code - 998361");
    expect(text).toMatch(/\d{1,2}:\d{2} (am|pm) IST/);
    hasNot(text, "Scan to pay");
    hasNot(text, "INR ");
  });

  it("export invoice in a foreign currency: 2 columns, LUT line instead of tax, code before the number; LUT is required", async () => {
    const exp: PdfInvoice = { ...invoice, number: "EOM/26-27/0012", docType: "EXPORT_INVOICE", taxMode: "EXPORT_LUT", currency: "AED", placeOfSupply: "Outside India (AE)", gstPercent: 0, gstAmount: 0, cgstAmount: 0, sgstAmount: 0, items: [{ description: "Social media — October", qty: 1, unit: "FIXED", rate: 2700, amount: 2700 }], subtotal: 2700, total: 2700, description: "" };
    const { text } = await pdfText(await renderInvoicePdf(exp, { name: "Acme LLC", address: "Dubai" }, company));
    has(text, "Export Invoice");
    has(text, "Description Total Amount");
    hasNot(text, "Amount Tax Total");
    has(text, "Social media — October AED2,700");
    has(text, "Supply meant for export under LUT No. AD190424009251F, without payment of IGST");
    expect(text).not.toMatch(/CGST|SGST|IGST \d/);
    has(text, "Total amount to be paid : AED2,700");
    await expect(renderInvoicePdf(exp, { name: "Acme" }, { ...company, lutNumber: "" })).rejects.toThrow(/LUT/);
  });

  it("proforma and credit note titles / meta lines; IGST totals; UPI QR only when a UPI id is set", async () => {
    const pro = await pdfText(await renderInvoicePdf({ ...invoice, docType: "PROFORMA", taxMode: "NONE", gstPercent: 0, gstAmount: 0, cgstAmount: 0, sgstAmount: 0, total: 30000 }, client, company));
    has(pro.text, "Proforma Invoice 08/10/2026");
    has(pro.text, "Description Total Amount");
    has(pro.text, "Total amount to be paid : ₹30,000");
    const cn = await pdfText(await renderInvoicePdf({ ...invoice, number: "EOM-CN/26-27/0002", docType: "CREDIT_NOTE", creditNoteOf: "EOM/26-27/0045" }, client, company));
    has(cn.text, "Credit Note EOM-CN/26-27/0002 08/10/2026");
    has(cn.text, "Credit To:");
    has(cn.text, "Against invoice EOM/26-27/0045");
    has(cn.text, "Total credit : ₹35,400");
    const igst = await pdfText(await renderInvoicePdf({ ...invoice, taxMode: "IGST", cgstAmount: 0, sgstAmount: 0, igstAmount: 5400, partLabel: "Part 1 of 2" }, client, { ...company, upiId: "eom@idfc" }));
    has(igst.text, "IGST 18% ₹5,400");
    has(igst.text, "Scan to pay");
    has(igst.text, "Payment schedule: Part 1 of 2");
    const draft = await pdfText(await renderInvoicePdf({ ...invoice, number: "DRAFT-abc" }, client, { ...company, signatureData: null, logoData: Buffer.from("not-an-image") }));
    has(draft.text, "Draft invoice 08/10/2026");
    has(draft.text, "Authorised signatory");
  });

  it("many line items flow onto a second page without losing the totals", async () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ description: `Line item ${i + 1} — a reasonably long description that wraps`, qty: 1, unit: "FIXED" as const, rate: 100, amount: 100 }));
    const { text, pages } = await pdfText(await renderInvoicePdf({ ...invoice, items, subtotal: 4000, gstAmount: 720, cgstAmount: 360, sgstAmount: 360, total: 4720 }, client, company));
    expect(pages).toBeGreaterThanOrEqual(2);
    has(text, "Line item 40");
    has(text, "Total amount to be paid : ₹4,720");
  });

  it("titles, meta text and tax rows are pure", () => {
    expect(documentTitle({ docType: "TAX_INVOICE" })).toBe("Tax Invoice");
    expect(documentTitle({ docType: "EXPORT_INVOICE" })).toBe("Export Invoice");
    expect(documentTitle({ docType: "PROFORMA" })).toBe("Proforma Invoice");
    expect(documentTitle({ docType: "CREDIT_NOTE" })).toBe("Credit Note");
    expect(metaText({ docType: "TAX_INVOICE", number: "45", issuedAt: new Date("2026-10-08T06:00:00Z") }, "Asia/Kolkata")).toBe("Invoice No. 45  08/10/2026");
    expect(metaText({ docType: "TAX_INVOICE", number: "45", issuedAt: new Date("2026-10-08T20:00:00Z") }, "Asia/Kolkata")).toBe("Invoice No. 45  09/10/2026"); // IST date
    expect(taxRows(invoice)).toEqual([
      ["CGST 9%", 2700],
      ["SGST 9%", 2700],
    ]);
    expect(taxRows({ ...invoice, taxMode: "IGST", igstAmount: 5400 })).toEqual([["IGST 18%", 5400]]);
    expect(taxRows({ ...invoice, taxMode: "EXPORT_LUT" })).toEqual([]);
    expect(taxRows({ ...invoice, taxMode: "NONE" })).toEqual([]);
    expect(fmtClock(new Date("2026-10-08T10:02:00Z"), "Asia/Kolkata")).toBe("3:32 pm IST");
  });

  it("receipt keeps its body but shares the header / footer", async () => {
    const buf = await renderReceiptPdf(
      { receiptNumber: "EOM-RCP/26-27/0001", receivedAt: new Date("2026-10-09T06:00:00Z"), amount: 31860, tdsAmount: 3540, method: "UPI", reference: "UTR123", invoiceNumber: "EOM/26-27/0045", invoiceTotal: 35400, totalReceived: 35400, balance: 0 },
      client,
      { ...company, logoData: Buffer.from("not-an-image") },
    );
    const { text } = await pdfText(buf);
    has(text, "Receipt No. EOM-RCP/26-27/0001 09/10/2026");
    has(text, "The Era Of Marketing Payment Receipt");
    has(text, "Received From: Invoice From:");
    has(text, "Against invoice : EOM/26-27/0045");
    has(text, "Amount received : ₹31,860");
    has(text, "TDS deducted by client : ₹3,540");
    has(text, "Balance outstanding : ₹0");
    has(text, "HSN Code - 998361");
  });

  it("upi link + QR", async () => {
    expect(upiPayUrl({ upiId: "eom@hdfc", payeeName: "Era Of Marketing", amount: 23600, note: "EOM/26-27/0001" })).toBe("upi://pay?pa=eom%40hdfc&pn=Era+Of+Marketing&am=23600.00&tn=EOM%2F26-27%2F0001&cu=INR");
    const png = await upiQrPng({ upiId: "eom@hdfc", payeeName: "EOM", amount: 10 });
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("money helpers", () => {
    expect(formatINR(123456.5)).toBe("₹1,23,456.50");
    expect(formatINRPlain(0)).toBe("INR 0.00");
    expect(formatCurrency(30000)).toBe("₹30,000");
    expect(formatCurrency(123456.5, "INR")).toBe("₹1,23,456.50");
    expect(formatCurrency(2700, "AED")).toBe("AED2,700");
    expect(formatCurrency(1234.5, "usd")).toBe("USD1,234.50");
    expect(formatMoney(2700, "AED")).toBe("AED 2,700.00");
    expect(formatMoney(2700, "INR")).toBe("₹2,700.00");
    expect(lineAmount({ qty: 2.5, unit: "HOURS", rate: 1000 })).toBe(2500);
    expect(lineAmount({ qty: 7, unit: "FIXED", rate: 999.99 })).toBe(999.99);
    expect(computeTotals([{ qty: 1, unit: "FIXED", rate: 100 }, { qty: 2, unit: "HOURS", rate: 50.5 }], 18)).toEqual({ subtotal: 201, gstAmount: 36.18, total: 237.18 });
    expect(toCsv([["a", 'b "q"'], [1, "x,y"]])).toBe('a,"b ""q"""\r\n1,"x,y"\r\n');
  });
});
