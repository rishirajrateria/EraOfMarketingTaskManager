import { round2 } from "@/server/finance/money";

/**
 * Pure GST helpers (ADR 0005): document type and tax mode are derived from GSTIN state codes.
 * Same state as the company → Tax Invoice with CGST + SGST; another Indian state → IGST;
 * client outside India → Export Invoice at 0% under LUT; proforma → no tax.
 */
export type DocType = "TAX_INVOICE" | "EXPORT_INVOICE" | "PROFORMA" | "CREDIT_NOTE";
export type TaxMode = "CGST_SGST" | "IGST" | "EXPORT_LUT" | "NONE";

/** GST state codes (first two digits of a GSTIN) → state / UT name. */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

export type StateRef = { code: string; name: string };

export function stateByCode(code: string | null | undefined): StateRef | null {
  if (!code) return null;
  const c = code.trim().padStart(2, "0");
  const name = GST_STATE_CODES[c];
  return name ? { code: c, name } : null;
}

/** `27AAAAA0000A1Z5` → `{ code: "27", name: "Maharashtra" }`; null when the GSTIN is malformed or the code is unknown. */
export function stateFromGstin(gstin: string | null | undefined): StateRef | null {
  if (!gstin) return null;
  const g = gstin.replace(/\s+/g, "").toUpperCase();
  if (!/^\d{2}[0-9A-Z]{13}$/.test(g)) return null;
  return stateByCode(g.slice(0, 2));
}

export type TaxClient = { country?: string | null; stateCode?: string | null; stateName?: string | null; gstNumber?: string | null };

export type TaxResolution = { docType: DocType; taxMode: TaxMode; placeOfSupply: string };

function stateLabel(s: StateRef | null, fallback: string): string {
  return s ? `${s.code} - ${s.name}` : fallback;
}

/** The company's own state: Settings.stateCode first, else derived from the company GSTIN. */
export function companyStateCode(settings: { stateCode?: string | null; gstNumber?: string | null }): string | null {
  const explicit = stateByCode(settings.stateCode);
  if (explicit) return explicit.code;
  return stateFromGstin(settings.gstNumber)?.code ?? null;
}

/**
 * Derive document type, tax mode and place of supply for a client.
 * `wanted` may opt into a PROFORMA (no tax); TAX/EXPORT are always resolved from the client.
 */
export function resolveTax(input: { companyStateCode: string | null; client: TaxClient; wanted?: DocType | null }): TaxResolution {
  const { client } = input;
  const country = (client.country ?? "IN").trim().toUpperCase() || "IN";
  const clientState = stateByCode(client.stateCode) ?? stateFromGstin(client.gstNumber);
  const companyState = stateByCode(input.companyStateCode);
  if (country !== "IN") {
    const place = `Outside India (${country})`;
    if (input.wanted === "PROFORMA") return { docType: "PROFORMA", taxMode: "NONE", placeOfSupply: place };
    return { docType: "EXPORT_INVOICE", taxMode: "EXPORT_LUT", placeOfSupply: place };
  }
  // An unregistered client without a state is billed as a local supply.
  const place = stateLabel(clientState ?? companyState, client.stateName ?? "India");
  if (input.wanted === "PROFORMA") return { docType: "PROFORMA", taxMode: "NONE", placeOfSupply: place };
  const intra = !clientState || !companyState || clientState.code === companyState.code;
  return { docType: "TAX_INVOICE", taxMode: intra ? "CGST_SGST" : "IGST", placeOfSupply: place };
}

export type TaxSplit = { cgst: number; sgst: number; igst: number; gstAmount: number; total: number };

/** CGST_SGST → half of gstPercent each; IGST → full; EXPORT_LUT / NONE → 0. */
export function splitTax(taxable: number, gstPercent: number, taxMode: TaxMode): TaxSplit {
  const base = round2(taxable);
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (taxMode === "CGST_SGST") {
    cgst = round2((base * gstPercent) / 200);
    sgst = cgst;
  } else if (taxMode === "IGST") {
    igst = round2((base * gstPercent) / 100);
  }
  const gstAmount = round2(cgst + sgst + igst);
  return { cgst, sgst, igst, gstAmount, total: round2(base + gstAmount) };
}

/** Effective GST percent for a tax mode: zero-rated modes force 0. */
export function effectiveGstPercent(gstPercent: number, taxMode: TaxMode): number {
  return taxMode === "EXPORT_LUT" || taxMode === "NONE" ? 0 : gstPercent;
}
