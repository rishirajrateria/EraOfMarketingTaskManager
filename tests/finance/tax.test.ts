import { describe, it, expect } from "vitest";
import { GST_STATE_CODES, companyStateCode, effectiveGstPercent, resolveTax, splitTax, stateByCode, stateFromGstin } from "@/server/finance/tax";
import { settle } from "@/server/finance/money";

describe("tax resolution (pure, ADR 0005)", () => {
  it("knows every GST state code and derives the state from a GSTIN", () => {
    expect(Object.keys(GST_STATE_CODES).length).toBeGreaterThanOrEqual(37);
    expect(stateByCode("27")).toEqual({ code: "27", name: "Maharashtra" });
    expect(stateByCode("7")).toEqual({ code: "07", name: "Delhi" });
    expect(stateByCode("xx")).toBeNull();
    expect(stateFromGstin("27AAAAA0000A1Z5")).toEqual({ code: "27", name: "Maharashtra" });
    expect(stateFromGstin(" 29abcde1234f1z5 ")).toEqual({ code: "29", name: "Karnataka" });
    expect(stateFromGstin("ABC")).toBeNull();
    expect(stateFromGstin("99AAAAA0000A1Z5")).toEqual({ code: "99", name: "Centre Jurisdiction" });
    expect(stateFromGstin("00AAAAA0000A1Z5")).toBeNull();
    expect(companyStateCode({ stateCode: "", gstNumber: "27AAAAA0000A1Z5" })).toBe("27");
    expect(companyStateCode({ stateCode: "29", gstNumber: "27AAAAA0000A1Z5" })).toBe("29");
    expect(companyStateCode({ stateCode: "", gstNumber: "" })).toBeNull();
  });

  it("same state → TAX_INVOICE with CGST+SGST; other state → IGST; abroad → EXPORT under LUT; proforma → none", () => {
    const company = "27";
    expect(resolveTax({ companyStateCode: company, client: { gstNumber: "27AAAAA0000A1Z5" } })).toEqual({ docType: "TAX_INVOICE", taxMode: "CGST_SGST", placeOfSupply: "27 - Maharashtra" });
    expect(resolveTax({ companyStateCode: company, client: { gstNumber: "29AAAAA0000A1Z5" } })).toEqual({ docType: "TAX_INVOICE", taxMode: "IGST", placeOfSupply: "29 - Karnataka" });
    // an explicit stateCode wins for unregistered clients; no state at all is treated as a local supply
    expect(resolveTax({ companyStateCode: company, client: { stateCode: "07" } }).taxMode).toBe("IGST");
    expect(resolveTax({ companyStateCode: company, client: {} })).toMatchObject({ taxMode: "CGST_SGST", placeOfSupply: "27 - Maharashtra" });
    expect(resolveTax({ companyStateCode: null, client: { gstNumber: "29AAAAA0000A1Z5" } }).taxMode).toBe("CGST_SGST");
    expect(resolveTax({ companyStateCode: company, client: { country: "us" } })).toEqual({ docType: "EXPORT_INVOICE", taxMode: "EXPORT_LUT", placeOfSupply: "Outside India (US)" });
    expect(resolveTax({ companyStateCode: company, client: { gstNumber: "29AAAAA0000A1Z5" }, wanted: "PROFORMA" })).toEqual({ docType: "PROFORMA", taxMode: "NONE", placeOfSupply: "29 - Karnataka" });
    expect(resolveTax({ companyStateCode: company, client: { country: "DE" }, wanted: "PROFORMA" }).taxMode).toBe("NONE");
  });

  it("splits 18% as 9/9 for CGST+SGST, full for IGST and zero for export / none", () => {
    expect(splitTax(20000, 18, "CGST_SGST")).toEqual({ cgst: 1800, sgst: 1800, igst: 0, gstAmount: 3600, total: 23600 });
    expect(splitTax(20000, 18, "IGST")).toEqual({ cgst: 0, sgst: 0, igst: 3600, gstAmount: 3600, total: 23600 });
    expect(splitTax(20000, 18, "EXPORT_LUT")).toEqual({ cgst: 0, sgst: 0, igst: 0, gstAmount: 0, total: 20000 });
    expect(splitTax(20000, 18, "NONE").total).toBe(20000);
    expect(splitTax(1234.56, 5, "CGST_SGST")).toEqual({ cgst: 30.86, sgst: 30.86, igst: 0, gstAmount: 61.72, total: 1296.28 });
    expect(effectiveGstPercent(18, "EXPORT_LUT")).toBe(0);
    expect(effectiveGstPercent(18, "IGST")).toBe(18);
  });

  it("settlement counts payments + TDS + credit notes against the total", () => {
    expect(settle({ total: 23600, payments: [{ amount: 21600, tdsAmount: 2000 }] })).toMatchObject({ received: 21600, tds: 2000, credited: 0, settled: 23600, balance: 0, paid: true });
    expect(settle({ total: 23600, payments: [{ amount: 10000 }], creditNotes: [{ total: 5900 }] })).toMatchObject({ settled: 15900, balance: 7700, paid: false });
    expect(settle({ total: 23600, payments: [{ amount: 23599.996 }] }).paid).toBe(true);
  });
});
