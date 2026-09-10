import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

describe("finance sheet two-way sync", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
  });

  it("parses header-based and positional payment rows", async () => {
    const { parsePaymentRows } = await import("@/server/finance/sheets-sync");
    const withHeader = parsePaymentRows([
      ["client", "invoiceNumber", "amount", "receivedAt", "method", "reference"],
      ["Repo", "EOM-INV-0001", "₹1,000.00", "2026-09-05", "UPI", "UTR9"],
      ["", "", "", "", "", ""],
    ]);
    expect(withHeader).toEqual([expect.objectContaining({ invoiceNumber: "EOM-INV-0001", amount: 1000, method: "UPI", reference: "UTR9" })]);
    const positional = parsePaymentRows([["EOM-INV-0002", "50"]]);
    expect(positional[0]).toMatchObject({ invoiceNumber: "EOM-INV-0002", amount: 50, method: "BANK_TRANSFER", reference: null });
  });

  it("imports only rows not yet recorded (by reference, receiptNumber or number+amount+day)", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    const { recordPayment } = await import("@/server/finance/payments");
    const { importPaymentRows, syncFinanceSheet } = await import("@/server/finance/sheets-sync");
    const c = await createInvoice({ clientId: seed.client.id, items: [{ description: "Retainer", rate: 10000 }], sendNow: true });
    if (!c.ok) throw new Error(c.error);
    const p = await recordPayment({ invoiceId: c.data.id, amount: 1000, receivedAt: "2026-09-05", reference: "UTR1" });
    if (!p.ok) throw new Error(p.error);
    const res = await importPaymentRows(
      [
        ["invoiceNumber", "amount", "receivedAt", "method", "reference", "receiptNumber"],
        ["EOM-INV-0001", "1000", "2026-09-05", "UPI", "UTR1", ""], // dup by reference
        ["EOM-INV-0001", "1000", "2026-09-05", "UPI", "", p.data.receiptNumber!], // dup by receipt number
        ["EOM-INV-0001", "2000", "2026-09-06", "BANK_TRANSFER", "", ""], // new
        ["EOM-INV-9999", "5", "2026-09-06", "", "", ""], // unknown invoice
      ],
      seed.admin.id,
    );
    expect(res).toEqual({ imported: 1, skipped: 3 });
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: c.data.id }, include: { payments: true } });
    expect(inv.payments).toHaveLength(2);
    expect(inv.status).toBe("PARTIALLY_PAID");
    // re-import of the same rows is a no-op (number+amount+day match)
    expect(await importPaymentRows([["EOM-INV-0001", "2000", "2026-09-06"]], seed.admin.id)).toEqual({ imported: 0, skipped: 1 });
    const sync = await syncFinanceSheet(seed.admin.id);
    expect(sync.spreadsheetId).toBe("mock_sheet_finance");
    expect(sync.rows).toBeGreaterThanOrEqual(3);
  });

  it("finance actions are ADMIN-only for mutations", async () => {
    const { syncFinance, pullFinancePayments } = await import("@/server/finance/finance");
    const ca = await testDb.user.create({ data: { email: "ca@external.test", name: "CA", role: "CA", activatedAt: new Date() } });
    session.set({ id: ca.id, role: "CA" });
    expect((await syncFinance()).ok).toBe(false);
    expect((await pullFinancePayments()).ok).toBe(false);
    session.set({ id: seed.admin.id, role: "ADMIN" });
    const ok = await pullFinancePayments();
    expect(ok.ok && ok.data).toMatchObject({ imported: 0, skipped: 0 });
  });
});
