import { describe, it, expect } from "vitest";
import { renderInvoicePdf, renderReceiptPdf, type PdfCompany } from "@/server/finance/pdf";
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
};

describe("pdf + money", () => {
  it("renders an invoice PDF buffer", async () => {
    const buf = await renderInvoicePdf(
      {
        number: "EOM-INV-0001",
        issuedAt: new Date("2026-09-10T00:00:00Z"),
        dueDate: new Date("2026-09-25T00:00:00Z"),
        items: [
          { description: "Social media management — September", hsnSac: "998371", qty: 10, unit: "HOURS", rate: 1500, amount: 15000 },
          { description: "Logo design", hsnSac: "998391", qty: 1, unit: "FIXED", rate: 5000, amount: 5000 },
        ],
        subtotal: 20000,
        gstPercent: 18,
        gstAmount: 3600,
        total: 23600,
        paymentTerms: "Payment due within 15 days.",
        notes: "Thank you for your business.",
      },
      { name: "Repo", address: "Pune", gstNumber: "27AAAAA0000A1Z5", email: "billing@repo.test" },
      company,
    );
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(1000);
  });
  it("renders a receipt PDF buffer (with a logo it cannot parse → skipped)", async () => {
    const buf = await renderReceiptPdf(
      { receiptNumber: "EOM-RCP-0001", receivedAt: new Date(), amount: 10000, method: "UPI", reference: "UTR123", invoiceNumber: "EOM-INV-0001", invoiceTotal: 23600, totalReceived: 10000 },
      { name: "Repo" },
      { ...company, logoData: Buffer.from("not-an-image") },
    );
    expect(buf.subarray(0, 4).toString("ascii")).toBe("%PDF");
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
