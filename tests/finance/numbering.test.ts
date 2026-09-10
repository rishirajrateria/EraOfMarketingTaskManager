import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { allocateInvoiceNumber, allocateReceiptNumber, formatNumber } from "@/server/finance/numbering";
import { prisma } from "@/lib/db";

describe("numbering", () => {
  beforeEach(async () => {
    await resetDb();
    await seedBasics();
  });
  it("formats with prefix and zero padding", () => {
    expect(formatNumber("EOM-INV-", 7)).toBe("EOM-INV-0007");
    expect(formatNumber("X", 12345)).toBe("X12345");
  });
  it("allocates sequential, unique numbers across concurrent transactions", async () => {
    const numbers = await Promise.all(Array.from({ length: 8 }, () => prisma.$transaction((tx) => allocateInvoiceNumber(tx))));
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.sort()).toEqual(Array.from({ length: 8 }, (_, i) => `EOM-INV-${String(i + 1).padStart(4, "0")}`));
    const s = await testDb.companySettings.findUnique({ where: { id: "default" } });
    expect(s?.invoiceNextNumber).toBe(9);
  });
  it("receipts use their own sequence and settings prefix", async () => {
    await testDb.companySettings.update({ where: { id: "default" }, data: { receiptPrefix: "RCP/26-27/", receiptNextNumber: 42 } });
    expect(await allocateReceiptNumber()).toBe("RCP/26-27/0042");
    expect(await allocateReceiptNumber()).toBe("RCP/26-27/0043");
    expect(await allocateInvoiceNumber()).toBe("EOM-INV-0001");
  });
  it("bootstraps settings when the row is missing", async () => {
    await testDb.companySettings.deleteMany();
    expect(await allocateInvoiceNumber()).toBe("EOM-INV-0001");
  });
});
