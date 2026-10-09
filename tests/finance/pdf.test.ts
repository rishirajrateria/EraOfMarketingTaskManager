import { describe, it, expect } from "vitest";
import { documentTitle, renderInvoicePdf, renderReceiptPdf, taxRows, type PdfCompany, type PdfInvoice } from "@/server/finance/pdf";
import { upiPayUrl, upiQrPng } from "@/server/finance/qr";
import { computeTotals, formatINR, formatINRPlain, lineAmount, toCsv } from "@/server/finance/money";

const company: PdfCompany = {
  companyName: "Era Of Marketing",
  address: "Mumbai, India",
  gstNumber: "27ABCDE1234F1Z5",
  bankName: "HDFC",
  bankAccountName: "Era Of Marketing",
  bankAccountNumber: "1234567890",
  bankIfsc: "HDFC0000001",
  upiId: "eom@hdfc",
  lutNumber: "AD270326000123X",
};

const invoice: PdfInvoice = {
  number: "EOM/26-27/0001",
  issuedAt: new Date("2026-09-10T00:00:00Z"),
  dueDate: new Date("2026-09-25T00:00:00Z"),
  docType: "TAX_INVOICE",
  taxMode: "CGST_SGST",
  placeOfSupply: "27 - Maharashtra",
  description: "Social media retainer for September, as agreed on the call.",
  partLabel: "Part 2 of 3",
  items: [
    { description: "Social media management — September", hsnSac: "998371", qty: 10, unit: "HOURS", rate: 1500, amount: 15000 },
    { description: "Logo design", hsnSac: "998391", qty: 1, unit: "FIXED", rate: 5000, amount: 5000 },
  ],
  subtotal: 20000,
  gstPercent: 18,
  gstAmount: 3600,
  cgstAmount: 1800,
  sgstAmount: 1800,
  igstAmount: 0,
  total: 23600,
  paymentTerms: "Payment due within 15 days.",
  notes: "Thank you for your business.",
};

describe("pdf + money", () => {
  it("renders an invoice PDF buffer with UPI QR, CGST/SGST lines and a description", async () => {
    const buf = await renderInvoicePdf(invoice, { name: "Repo", address: "Pune", gstNumber: "27AAAAA0000A1Z5", email: "billing@repo.test", phone: "+91 98765 43210" }, company);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(1000);
    const plain = await renderInvoicePdf({ ...invoice, taxMode: "IGST", igstAmount: 3600 }, { name: "Repo" }, { ...company, upiId: "" });
    expect(plain.length).toBeLessThan(buf.length); // no QR image embedded
  });
  it("titles and tax lines follow the document / tax mode", () => {
    expect(documentTitle({ docType: "TAX_INVOICE" }, company)).toEqual({ title: "TAX INVOICE", subtitle: null });
    expect(documentTitle({ docType: "EXPORT_INVOICE" }, company).subtitle).toContain("LUT No. AD270326000123X");
    expect(documentTitle({ docType: "PROFORMA" }, company).title).toBe("PROFORMA INVOICE");
    expect(documentTitle({ docType: "CREDIT_NOTE", creditNoteOf: "EOM/26-27/0001" }, company)).toEqual({ title: "CREDIT NOTE", subtitle: "Against invoice EOM/26-27/0001" });
    expect(taxRows(invoice)).toEqual([
      ["CGST @ 9%", "INR 1,800.00"],
      ["SGST @ 9%", "INR 1,800.00"],
    ]);
    expect(taxRows({ ...invoice, taxMode: "IGST", igstAmount: 3600 })).toEqual([["IGST @ 18%", "INR 3,600.00"]]);
    expect(taxRows({ ...invoice, taxMode: "EXPORT_LUT", gstPercent: 0 })).toEqual([["IGST @ 0% (export under LUT)", "INR 0.00"]]);
    expect(taxRows({ ...invoice, taxMode: "NONE" })).toEqual([["GST", "Not applicable"]]);
  });
  it("renders export, proforma and credit-note documents", async () => {
    for (const doc of [
      { ...invoice, docType: "EXPORT_INVOICE" as const, taxMode: "EXPORT_LUT" as const, gstPercent: 0, gstAmount: 0, cgstAmount: 0, sgstAmount: 0, total: 20000, placeOfSupply: "Outside India (US)" },
      { ...invoice, docType: "PROFORMA" as const, taxMode: "NONE" as const },
      { ...invoice, docType: "CREDIT_NOTE" as const, creditNoteOf: "EOM/26-27/0001", partLabel: null },
    ]) {
      const buf = await renderInvoicePdf(doc, { name: "Repo" }, company);
      expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    }
  });
  it("renders a receipt PDF buffer with a TDS line (and a logo it cannot parse → skipped)", async () => {
    const buf = await renderReceiptPdf(
      { receiptNumber: "EOM-RCP/26-27/0001", receivedAt: new Date(), amount: 21600, tdsAmount: 2000, method: "UPI", reference: "UTR123", invoiceNumber: "EOM/26-27/0001", invoiceTotal: 23600, totalReceived: 23600, balance: 0 },
      { name: "Repo" },
      { ...company, logoData: Buffer.from("not-an-image") },
    );
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
  it("upi link + QR", async () => {
    expect(upiPayUrl({ upiId: "eom@hdfc", payeeName: "Era Of Marketing", amount: 23600, note: "EOM/26-27/0001" })).toBe("upi://pay?pa=eom%40hdfc&pn=Era+Of+Marketing&am=23600.00&tn=EOM%2F26-27%2F0001&cu=INR");
    const png = await upiQrPng({ upiId: "eom@hdfc", payeeName: "EOM", amount: 10 });
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
  });
  it("money helpers", () => {
    expect(formatINR(123456.5)).toBe("₹1,23,456.50");
    expect(formatINRPlain(0)).toBe("INR 0.00");
    expect(lineAmount({ qty: 2.5, unit: "HOURS", rate: 1000 })).toBe(2500);
    expect(lineAmount({ qty: 7, unit: "FIXED", rate: 999.99 })).toBe(999.99);
    expect(computeTotals([{ qty: 1, unit: "FIXED", rate: 100 }, { qty: 2, unit: "HOURS", rate: 50.5 }], 18)).toEqual({ subtotal: 201, gstAmount: 36.18, total: 237.18 });
    expect(toCsv([["a", 'b "q"'], [1, "x,y"]])).toBe('a,"b ""q"""\r\n1,"x,y"\r\n');
  });
});
