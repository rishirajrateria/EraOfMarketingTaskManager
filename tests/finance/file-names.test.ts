import { describe, it, expect } from "vitest";
import { clientDisplayName, contentDisposition, invoiceFileName, sanitizeFileNamePart } from "@/server/finance/file-names";
import { mimeFileName } from "@/google/gmail";

/** ADR 0013: one naming helper for every invoice PDF (Drive, email, WhatsApp link, downloads). */
const client = { name: "Acme", businessName: "Acme Pvt Ltd" };

describe("invoice file names", () => {
  it("tax, export, proforma, cancelled, draft and credit note", () => {
    expect(invoiceFileName({ number: "EOM/26-27/0001", docType: "TAX_INVOICE", client })).toBe("Invoice No. EOM-26-27-0001 (Acme Pvt Ltd).pdf");
    expect(invoiceFileName({ number: "EOM/26-27/0002", docType: "EXPORT_INVOICE", taxMode: "EXPORT_LUT", client })).toBe("Ex Invoice No. EOM-26-27-0002 (Acme Pvt Ltd).pdf");
    expect(invoiceFileName({ number: "EOM/26-27/0003", docType: "TAX_INVOICE", taxMode: "EXPORT_LUT", client })).toBe("Ex Invoice No. EOM-26-27-0003 (Acme Pvt Ltd).pdf");
    expect(invoiceFileName({ number: "EOM-PRO/26-27/0001", docType: "PROFORMA", client })).toBe("P Invoice (Acme Pvt Ltd).pdf");
    expect(invoiceFileName({ number: "DRAFT-abc", docType: "PROFORMA", client })).toBe("P Invoice (Acme Pvt Ltd).pdf");
    expect(invoiceFileName({ number: "EOM/26-27/0001", docType: "TAX_INVOICE", status: "CANCELLED", client })).toBe("C Invoice No. EOM-26-27-0001 (Acme Pvt Ltd).pdf");
    expect(invoiceFileName({ number: "EOM/26-27/0002", docType: "EXPORT_INVOICE", client }, { cancelled: true })).toBe("C Invoice No. EOM-26-27-0002 (Acme Pvt Ltd).pdf");
    expect(invoiceFileName({ number: "DRAFT-ck1", docType: "TAX_INVOICE", client })).toBe("Draft Invoice (Acme Pvt Ltd).pdf");
    expect(invoiceFileName({ number: "EOM-CN/26-27/0001", docType: "CREDIT_NOTE", client })).toBe("EOM-CN_26-27_0001.pdf");
  });

  it("uses the business name when set, else the client name, and strips illegal characters", () => {
    expect(clientDisplayName({ name: "Acme", businessName: null })).toBe("Acme");
    expect(clientDisplayName({ name: "Acme", businessName: "   " })).toBe("Acme");
    expect(invoiceFileName({ number: "EOM/26-27/0009", docType: "TAX_INVOICE", client: { name: 'A/B: "Best" <Co>* | Ltd?' } })).toBe("Invoice No. EOM-26-27-0009 (A-B Best Co Ltd).pdf");
    expect(sanitizeFileNamePart("  ..a\\b\tc..  ")).toBe("a-b c");
    expect(clientDisplayName({ name: "???" })).toBe("Client");
    expect(clientDisplayName({ name: "x".repeat(200) }).length).toBe(80);
    expect(invoiceFileName({ number: "EOM/26-27/0010", docType: "TAX_INVOICE", client: { name: "शर्मा ट्रेडर्स" } })).toBe("Invoice No. EOM-26-27-0010 (शर्मा ट्रेडर्स).pdf");
  });

  it("headers survive spaces, parentheses and non-Latin names", () => {
    expect(contentDisposition("attachment", "Invoice No. EOM-26-27-0001 (Acme Pvt Ltd).pdf")).toBe(
      `attachment; filename="Invoice No. EOM-26-27-0001 (Acme Pvt Ltd).pdf"; filename*=UTF-8''Invoice%20No.%20EOM-26-27-0001%20%28Acme%20Pvt%20Ltd%29.pdf`,
    );
    const hindi = contentDisposition("inline", "P Invoice (शर्मा).pdf");
    expect(hindi).toMatch(/^inline; filename="P Invoice \(_+\)\.pdf"; filename\*=UTF-8''P%20Invoice%20%28%E0%A4/);
    expect(mimeFileName("P Invoice (Acme).pdf")).toBe("P Invoice (Acme).pdf");
    expect(mimeFileName("P Invoice (शर्मा).pdf")).toBe(`=?UTF-8?B?${Buffer.from("P Invoice (शर्मा).pdf").toString("base64")}?=`);
  });
});
