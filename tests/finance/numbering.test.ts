import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { allocateInvoiceNumber, allocateReceiptNumber, financialYearKey, formatNumber, normalizePrefix } from "@/server/finance/numbering";
import { prisma } from "@/lib/db";

const TZ = "Asia/Kolkata";
const FY = financialYearKey(new Date(), TZ);
const pad = (n: number) => String(n).padStart(4, "0");

describe("financial-year numbering (pure)", () => {
  it("financialYearKey: 1 April – 31 March in the company timezone", () => {
    expect(financialYearKey(new Date("2026-09-15T00:00:00Z"), TZ)).toBe("26-27");
    expect(financialYearKey(new Date("2027-02-10T00:00:00Z"), TZ)).toBe("26-27");
    expect(financialYearKey(new Date("2027-03-31T10:00:00Z"), TZ)).toBe("26-27");
    expect(financialYearKey(new Date("2027-04-01T00:00:00Z"), TZ)).toBe("27-28");
    expect(financialYearKey(new Date("2025-04-01T00:00:00Z"), TZ)).toBe("25-26");
    // 31 Mar 23:30 UTC is already 1 Apr 05:00 in Kolkata → the timezone decides the year
    expect(financialYearKey(new Date("2027-03-31T23:30:00Z"), TZ)).toBe("27-28");
    expect(financialYearKey(new Date("2027-03-31T23:30:00Z"), "UTC")).toBe("26-27");
    expect(financialYearKey(new Date("2099-12-31T00:00:00Z"), TZ)).toBe("99-00");
  });

  it("formatNumber: prefix/FY/4-digit counter; legacy prefixes are normalised", () => {
    expect(formatNumber("EOM", "25-26", 1)).toBe("EOM/25-26/0001");
    expect(formatNumber("EOM-RCP", "25-26", 7)).toBe("EOM-RCP/25-26/0007");
    expect(formatNumber("EOM-INV-", "26-27", 7)).toBe("EOM/26-27/0007");
    expect(formatNumber("EOM-RCP-", "26-27", 12345)).toBe("EOM-RCP/26-27/12345");
    expect(normalizePrefix("ACME/")).toBe("ACME");
    expect(normalizePrefix("")).toBe("EOM");
  });
});

describe("numbering (db)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedBasics();
  });

  it("allocates sequential, unique numbers across concurrent transactions and records the FY key", async () => {
    const numbers = await Promise.all(Array.from({ length: 8 }, () => prisma.$transaction((tx) => allocateInvoiceNumber(tx))));
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.sort()).toEqual(Array.from({ length: 8 }, (_, i) => `EOM/${FY}/${pad(i + 1)}`));
    const s = await testDb.companySettings.findUniqueOrThrow({ where: { id: "default" } });
    expect(s.invoiceNextNumber).toBe(9);
    expect(s.numberingFyKey).toBe(FY);
  });

  it("receipts use their own sequence and settings prefix; a configured start is kept while no FY key is stored", async () => {
    await testDb.companySettings.update({ where: { id: "default" }, data: { receiptPrefix: "RCP", receiptNextNumber: 42 } });
    expect(await allocateReceiptNumber()).toBe(`RCP/${FY}/0042`);
    expect(await allocateReceiptNumber()).toBe(`RCP/${FY}/0043`);
    expect(await allocateInvoiceNumber()).toBe(`EOM/${FY}/0001`);
  });

  it("bootstraps settings when the row is missing", async () => {
    await testDb.companySettings.deleteMany();
    expect(await allocateInvoiceNumber()).toBe(`EOM/${FY}/0001`);
  });

  it("resets both sequences to 0001 on 1 April and stores the new key", async () => {
    const march = new Date("2027-03-15T06:00:00Z");
    const april = new Date("2027-04-02T06:00:00Z");
    expect(await allocateInvoiceNumber(prisma, march)).toBe("EOM/26-27/0001");
    expect(await allocateInvoiceNumber(prisma, march)).toBe("EOM/26-27/0002");
    expect(await allocateReceiptNumber(prisma, march)).toBe("EOM-RCP/26-27/0001");
    expect(await allocateReceiptNumber(prisma, march)).toBe("EOM-RCP/26-27/0002");
    expect((await testDb.companySettings.findUniqueOrThrow({ where: { id: "default" } })).numberingFyKey).toBe("26-27");

    // first allocation of the new financial year restarts both counters — and only once
    expect(await allocateReceiptNumber(prisma, april)).toBe("EOM-RCP/27-28/0001");
    expect(await allocateInvoiceNumber(prisma, april)).toBe("EOM/27-28/0001");
    expect(await allocateInvoiceNumber(prisma, april)).toBe("EOM/27-28/0002");
    expect(await allocateReceiptNumber(prisma, april)).toBe("EOM-RCP/27-28/0002");
    const s = await testDb.companySettings.findUniqueOrThrow({ where: { id: "default" } });
    expect(s).toMatchObject({ numberingFyKey: "27-28", invoiceNextNumber: 3, receiptNextNumber: 3 });
  });

  it("a stale stored key resets the counters even when they were set by hand", async () => {
    await testDb.companySettings.update({ where: { id: "default" }, data: { numberingFyKey: "24-25", invoiceNextNumber: 40, receiptNextNumber: 9 } });
    expect(await allocateInvoiceNumber()).toBe(`EOM/${FY}/0001`);
    expect(await allocateReceiptNumber()).toBe(`EOM-RCP/${FY}/0001`);
  });
});
