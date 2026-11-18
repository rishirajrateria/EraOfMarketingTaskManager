import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import path from "path";

const asset = (name: string) => readFileSync(path.join(__dirname, "seed-assets", name));

/**
 * Demo defaults for the company profile (ADR 0007, ADR 0020). Written ONCE, when no CompanySettings row exists;
 * a seed run never overwrites what the owner has edited in Settings.
 */
export const DEMO_COMPANY_DEFAULTS = {
  companyName: "The Era Of Marketing",
  legalName: "The Era Of Marketing",
  gstNumber: "19CEWPR5040D1Z3",
  stateCode: "19",
  pan: "CEWPR5040D",
  iecCode: "CEWPR5040D",
  lutNumber: "AD190424009251F",
  address: "7th floor, Yamuna Building, 86 Golaghata Rd, Kolkata, West Bengal 700048, India",
  email: "contact@theeraofmarketing.com",
  phone: "918910358506",
  website: "www.theeraofmarketing.com",
  hsnSacCode: "998361",
  bankAccountName: "The Era Of Marketing",
  bankAccountNumber: "10126079826",
  bankSwift: "IDFBINBBMUM",
  bankIfsc: "IDFB0060102",
  bankName: "IDFC FIRST Bank LTD",
  bankAddress: "Salt Lake, Sector 1, Kolkata, West Bengal, India, Pincode 700064",
  logoData: asset("logo.png"),
  logoUrl: "/api/files/logo",
  signatureData: asset("signature.png"),
  signatureUrl: "/api/files/signature",
};

/** Creates the company settings row with demo defaults if absent; returns true when it created one. Never updates an existing row. */
export async function ensureCompanySettings(prisma: Pick<PrismaClient, "companySettings">): Promise<boolean> {
  const existing = await prisma.companySettings.findUnique({ where: { id: "default" }, select: { id: true } });
  if (existing) return false;
  await prisma.companySettings.create({ data: { id: "default", ...DEMO_COMPANY_DEFAULTS } });
  return true;
}
