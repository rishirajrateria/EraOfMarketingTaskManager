import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { financialYearKey } from "@/server/finance/numbering";

/**
 * ADR 0013: a proforma is only handed over — it can't be cancelled, isn't filed in the monthly Drive folders or
 * Finance/*, never counts in totals and never touches the tax invoice series. File names follow the helper.
 */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;
const FY = financialYearKey(new Date(), "Asia/Kolkata");
const INV = (n: number) => `EOM/${FY}/${String(n).padStart(4, "0")}`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function approved(extra: Record<string, unknown> = {}) {
  const { createInvoice, approveAndSend } = await import("@/server/finance/invoices");
  const c = await createInvoice({ clientId: seed.client.id, items: [{ description: "Retainer", rate: 50000 }], gstPercent: 18, dueDate: day(-5), ...extra });
  if (!c.ok) throw new Error(c.error);
  const s = await approveAndSend(c.data.id, { email: true });
  if (!s.ok) throw new Error(s.error);
  return c.data.id;
}

describe("proformas keep no record; invoice file names", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    await testDb.client.update({ where: { id: seed.client.id }, data: { email: "billing@repo.test", businessName: "Repo Media LLP" } });
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
    (await import("@/google/gmail")).sentMailDetails.length = 0;
    (await import("@/google/drive")).mockDriveLog.length = 0;
  });

  it("a sent proforma is named P Invoice, is not filed or counted and leaves the invoice series alone", async () => {
    const id = await approved({ docType: "PROFORMA" });
    const pro = await testDb.invoice.findUniqueOrThrow({ where: { id } });
    expect(pro).toMatchObject({ docType: "PROFORMA", status: "SENT", monthDriveFileId: null, pdfBackendFileId: null });
    expect(pro.pdfDriveFileId).toMatch(/^file_/); // the client folder copy only
    const { mockDriveLog } = await import("@/google/drive");
    expect(mockDriveLog.map((l) => l.name)).toEqual(["P Invoice (Repo Media LLP).pdf"]);
    expect(await testDb.financeMonthFolder.count()).toBe(0);
    expect((await import("@/google/gmail")).sentMailDetails[0].attachments[0].filename).toBe("P Invoice (Repo Media LLP).pdf");

    const { peekNextNumber } = await import("@/server/finance/numbering");
    expect(await peekNextNumber("TAX_INVOICE")).toBe(INV(1));
    const { financeSummary, paymentsDashboard } = await import("@/server/finance/queries");
    expect((await financeSummary()).totals).toMatchObject({ invoiced: 0, outstanding: 0 });
    expect((await paymentsDashboard()).tiles).toMatchObject({ outstanding: 0, overdue: 0 });
    const { driveFolderMonths } = await import("@/server/finance/drive-folders-queries");
    expect((await driveFolderMonths()).rows.reduce((s, r) => s + r.sales + r.cancelled, 0)).toBe(0);

    // the download carries the same name
    const { GET } = await import("@/app/api/files/invoice/[id]/route");
    const res = await GET(new Request(`http://localhost/api/files/invoice/${id}?download=1`), { params: Promise.resolve({ id }) });
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="P Invoice \(Repo Media LLP\)\.pdf"/);
  });

  it("a proforma cannot be cancelled (clear error, even before the form is valid) but can be deleted", async () => {
    const { cancelInvoice, deleteInvoice } = await import("@/server/finance/invoices");
    const { PROFORMA_CANCEL_ERROR } = await import("@/server/finance/cancel-core");
    const id = await approved({ docType: "PROFORMA" });
    expect(await cancelInvoice(id, { reason: "" })).toEqual({ ok: false, error: PROFORMA_CANCEL_ERROR });
    expect(await cancelInvoice(id, { reason: "Client changed scope" })).toEqual({ ok: false, error: PROFORMA_CANCEL_ERROR });
    expect((await testDb.invoice.findUniqueOrThrow({ where: { id } })).status).toBe("SENT");
    expect(await testDb.auditLog.count({ where: { action: "invoice.cancel" } })).toBe(0);
    expect((await deleteInvoice(id)).ok).toBe(true);
    expect(await testDb.invoice.count({ where: { id } })).toBe(0);
  });

  it("awaiting approval: proformas are counted as tasks but not as money", async () => {
    const { createInvoice } = await import("@/server/finance/invoices");
    await createInvoice({ clientId: seed.client.id, docType: "PROFORMA", items: [{ description: "Estimate", rate: 100000 }] });
    await createInvoice({ clientId: seed.client.id, items: [{ description: "Retainer", rate: 10000 }], gstPercent: 18 });
    const { paymentsDashboard } = await import("@/server/finance/queries");
    expect((await paymentsDashboard()).tiles).toMatchObject({ awaitingApprovalCount: 2, awaitingApproval: 11800 });
  });

  it("a tax invoice is filed as 'Invoice No. …' and a cancelled one becomes 'C Invoice No. …' everywhere", async () => {
    const id = await approved();
    const name = `Invoice No. ${INV(1).replace(/\//g, "-")} (Repo Media LLP).pdf`;
    const { mockDriveLog } = await import("@/google/drive");
    const folder = await testDb.financeMonthFolder.findFirstOrThrow();
    expect(mockDriveLog.filter((l) => l.op === "upload").map((l) => l.name)).toEqual([name, name, name]); // client folder, Finance/Invoices, Sales invoices
    expect(mockDriveLog.find((l) => l.parentId === folder.salesId)?.name).toBe(name);
    expect((await import("@/google/gmail")).sentMailDetails[0].attachments[0].filename).toBe(name);

    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id } });
    await testDb.invoice.update({ where: { id }, data: { status: "SENT" } });
    const { cancelInvoice } = await import("@/server/finance/invoices");
    expect((await cancelInvoice(id, { reason: "Wrong amount" })).ok).toBe(true);
    const cName = `C Invoice No. ${INV(1).replace(/\//g, "-")} (Repo Media LLP).pdf`;
    const updates = mockDriveLog.filter((l) => l.op === "update");
    expect(updates.map((u) => u.id).sort()).toEqual([inv.monthDriveFileId, inv.pdfDriveFileId, inv.pdfBackendFileId].sort());
    expect(new Set(updates.map((u) => u.name))).toEqual(new Set([cName]));
    const { GET } = await import("@/app/api/files/invoice/[id]/route");
    const res = await GET(new Request(`http://localhost/api/files/invoice/${id}`), { params: Promise.resolve({ id }) });
    expect(res.headers.get("Content-Disposition")).toContain(`inline; filename="${cName}"`);
  });
});
