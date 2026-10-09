import { describe, it, expect, beforeEach } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

/** ADR 0009: vendor bills + GST, the monthly GST pack, Finance/YYYY-MM Drive folders and the payables job. Asia/Kolkata. */
const session = mockSession();
let seed: Awaited<ReturnType<typeof seedBasics>>;

const pdf = (name = "bill.pdf", bytes = 64) => new File([new Uint8Array(bytes).fill(0x25)], name, { type: "application/pdf" });
const withFile = (f: File) => {
  const fd = new FormData();
  fd.set("bill", f);
  return fd;
};

async function bill(payee: string, amount: number, due: string, extra: Record<string, unknown> = {}) {
  const { createBill } = await import("@/server/finance/payables");
  const b = await createBill({ payee, category: "Rent", amount, dueDate: due, ...extra });
  if (!b.ok) throw new Error(b.error);
  return { id: b.data.id, occ: await testDb.expenseOccurrence.findFirstOrThrow({ where: { expenseId: b.data.id }, orderBy: { seq: "asc" } }) };
}

async function paid(payee: string, amount: number, on: string, gst: Record<string, unknown> | null, file: File | null, vendorGstin = "29ABCDE1234F1Z5") {
  const { markPaid } = await import("@/server/finance/payables");
  const b = await bill(payee, amount, on);
  const res = await markPaid(b.occ.id, { amount, paidOn: on, method: "BANK", gst: gst ? { includesGst: true, gstRate: 18, vendorGstin, itcClaimable: true, ...gst } : null }, file ? withFile(file) : null);
  if (!res.ok) throw new Error(res.error);
  return testDb.expenseOccurrence.findUniqueOrThrow({ where: { id: b.occ.id } });
}

describe("GST, bills and monthly Drive folders", () => {
  beforeEach(async () => {
    await resetDb();
    seed = await seedBasics();
    session.set({ id: seed.admin.id, role: "ADMIN" });
    (await import("@/lib/settings")).invalidateSettingsCache();
    (await import("@/google/gmail")).sentMailDetails.length = 0;
    (await import("@/google/drive")).trashedMockFiles.length = 0;
  });

  it("month folder: created once with its four subfolders (idempotent)", async () => {
    const { ensureMonthFolder, monthFolderUrls } = await import("@/server/finance/month-folders");
    const a = await ensureMonthFolder("2026-10");
    const b = await ensureMonthFolder("2026-10");
    expect(b).toEqual(a);
    expect(await testDb.financeMonthFolder.count()).toBe(1);
    expect(new Set([a.folderId, a.salesId, a.billsId, a.itcId, a.cancelledId]).size).toBe(5);
    expect(monthFolderUrls(a).itc).toBe(`https://drive.google.com/drive/folders/${a.itcId}`);
    await expect(ensureMonthFolder("2026-13")).rejects.toThrow(/yyyy-MM/);
    const { run } = await import("@/jobs/month-folders");
    const r = await run(new Date("2026-11-01T00:10:00+05:30"));
    expect(r).toMatchObject({ month: "2026-11" });
    expect(await testDb.financeMonthFolder.count()).toBe(2);
  });

  it("bill files: GST auto-split, filed into Expense bills (+ GST claimable) of the paid month; undo trashes the copies", async () => {
    const o = await paid("Skyline Spaces", 11800, "2026-10-05", {}, pdf());
    expect([o.gstAmount.toNumber(), o.gstRate?.toNumber(), o.itcClaimable, o.vendorGstin, o.billMime, o.billName]).toEqual([1800, 18, true, "29ABCDE1234F1Z5", "application/pdf", "bill.pdf"]);
    expect(o.billDriveId).toMatch(/^file_/);
    expect(o.itcDriveId).toMatch(/^file_/);
    expect((await testDb.expense.findUniqueOrThrow({ where: { id: o.expenseId } })).vendorGstin).toBe("29ABCDE1234F1Z5");
    expect(await testDb.financeMonthFolder.findUnique({ where: { month: "2026-10" } })).not.toBeNull();

    const { undoPaid, billDetails, attachBill } = await import("@/server/finance/payables");
    expect((await undoPaid(o.id)).ok).toBe(true);
    const undone = await testDb.expenseOccurrence.findUniqueOrThrow({ where: { id: o.id } });
    expect([undone.billDriveId, undone.itcDriveId, undone.billMime]).toEqual([null, null, "application/pdf"]); // file kept, Drive copies gone
    expect((await import("@/google/drive")).trashedMockFiles).toEqual(expect.arrayContaining([o.billDriveId, o.itcDriveId]));

    // not claimable → only Expense bills; validation of type / size
    const n = await paid("Office Mart", 590, "2026-10-06", { itcClaimable: false, gstRate: 18 }, pdf("receipt.pdf"));
    expect([n.itcClaimable, n.billDriveId !== null, n.itcDriveId]).toEqual([false, true, null]);
    const txt = await attachBill(n.id, withFile(new File(["hello"], "notes.txt", { type: "text/plain" })));
    expect(!txt.ok && txt.error).toMatch(/photo or a PDF/);
    const big = await attachBill(n.id, withFile(pdf("big.pdf", 12 * 1024 * 1024 + 1)));
    expect(!big.ok && big.error).toMatch(/max 12 MB/);
    // Bill & GST details on a DUE payment stores the file without filing it
    const due = await bill("Later Co", 1180, "2026-10-20");
    expect((await billDetails(due.occ.id, { includesGst: true, gstRate: 18, gstAmount: 180, itcClaimable: true }, withFile(pdf("later.pdf")))).ok).toBe(true);
    const d = await testDb.expenseOccurrence.findUniqueOrThrow({ where: { id: due.occ.id } });
    expect([d.gstAmount.toNumber(), d.billName, d.billDriveId]).toEqual([180, "later.pdf", null]);
    expect((await billDetails(due.occ.id, { includesGst: true, gstRate: 18, gstAmount: 5000 }, null)).ok).toBe(false); // GST > bill
  });

  it("GST pack: ZIP of the month's claimable bills + summary.csv; route is ADMIN only; send saves the finance email", async () => {
    await paid("Skyline Spaces", 11800, "2026-10-05", {}, pdf("rent-oct.pdf"));
    await paid("Print Hub", 5600, "2026-10-12", { gstRate: 12 }, null, "27PQRST6789K1Z2"); // claimable, bill missing
    await paid("Cafe", 525, "2026-10-13", { gstRate: 5, itcClaimable: false }, pdf("cafe.pdf")); // not claimable
    await paid("Skyline Spaces", 11800, "2026-09-05", {}, pdf("rent-sep.pdf")); // other month
    const { buildGstPack } = await import("@/server/finance/gst-pack");
    const pack = await buildGstPack("2026-10");
    expect(pack).toMatchObject({ month: "2026-10", label: "October 2026", attached: 1, missing: 1, gstTotal: 2400, fileName: "GST-pack-2026-10.zip" });
    const zip = unzipSync(new Uint8Array(pack.zip));
    const names = Object.keys(zip).sort();
    expect(names).toHaveLength(2);
    expect(names).toContain("summary.csv");
    const billName = names.find((n) => n !== "summary.csv")!;
    expect(billName).toMatch(/^2026-10-05-skyline-spaces-\w{6}\.pdf$/);
    expect(zip[billName].length).toBe(64);
    const csv = strFromU8(zip["summary.csv"]).split("\r\n");
    expect(csv[0]).toBe("date,payee,vendor GSTIN,bill amount,GST rate,GST amount,file name");
    expect(csv[1]).toBe(`2026-10-05,Skyline Spaces,29ABCDE1234F1Z5,11800.00,18,1800.00,${billName}`);
    expect(csv[2]).toBe("2026-10-12,Print Hub,27PQRST6789K1Z2,5600.00,12,600.00,MISSING");
    expect(csv).toContain("TOTAL,,,17400.00,,2400.00,");

    const { GET } = await import("@/app/api/finance/gst-pack/route");
    const res = await GET(new Request("http://x/api/finance/gst-pack?month=2026-10"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="GST-pack-2026-10.zip"');
    expect((await GET(new Request("http://x/api/finance/gst-pack?month=oct"))).status).toBe(400);
    session.set({ id: seed.hr.id, role: "HR" });
    expect((await GET(new Request("http://x/api/finance/gst-pack?month=2026-10"))).status).toBe(403);
    session.set({ id: seed.admin.id, role: "ADMIN" });

    const { sendGstPack } = await import("@/server/finance/payables");
    expect((await sendGstPack("2026-10", "not-an-email")).ok).toBe(false);
    const sent = await sendGstPack("2026-10", "ca@books.in");
    expect(sent.ok && sent.data).toMatchObject({ to: "ca@books.in", bills: 2, attached: 1, missing: 1, gstTotal: 2400 });
    expect((await testDb.companySettings.findUniqueOrThrow({ where: { id: "default" } })).financeEmail).toBe("ca@books.in");
    const mail = (await import("@/google/gmail")).sentMailDetails.at(-1)!;
    expect(mail).toMatchObject({ to: "ca@books.in", subject: "GST credit pack · October 2026 · Era Of Marketing" });
    expect(mail.attachments).toEqual([{ filename: "GST-pack-2026-10.zip", mimeType: "application/zip", size: pack.zip.length }]);
    expect(mail.text).toContain("Claimable bills: 2 (1 attached, 1 missing)");
    expect(mail.text).toContain("GST to claim: ₹2,400");
    const empty = await sendGstPack("2026-08", "ca@books.in");
    expect(!empty.ok && empty.error).toMatch(/No claimable GST bills paid in August 2026/);
  });

  it("approved invoices are filed into Sales invoices of their issue month (once)", async () => {
    const { createInvoice, approveAndSend } = await import("@/server/finance/invoices");
    const c = await createInvoice({ clientId: seed.client.id, items: [{ description: "Retainer", rate: 1000 }] });
    if (!c.ok) throw new Error(c.error);
    expect((await approveAndSend(c.data.id, {})).ok).toBe(true);
    const inv = await testDb.invoice.findUniqueOrThrow({ where: { id: c.data.id } });
    expect(inv.monthDriveFileId).toMatch(/^file_/);
    const { driveFolderMonths } = await import("@/server/finance/drive-folders-queries");
    const { rows } = await driveFolderMonths();
    expect(rows[0]).toMatchObject({ sales: 1, cancelled: 0 });
    expect(rows[0].urls?.folder).toMatch(/^https:\/\/drive\.google\.com\/drive\/folders\/folder_/);
  });

  it("payables job: reminds once per occurrence (due in N days / overdue) and materialises the next recurring payment", async () => {
    const { run } = await import("@/jobs/payables");
    const now = new Date("2026-10-09T06:00:00Z"); // 9 Oct, 11:30 IST
    await bill("Skyline Spaces", 25000, "2026-10-12", { remindDays: 3 });
    await bill("Far Away", 100, "2026-10-12", { remindDays: 1 });
    await bill("Late Co", 500, "2026-10-01", { remindDays: 0, category: "Office" });
    const parts = await bill("Studio", 2000, "2026-10-10", { plan: "PART", dueDate: null, partMode: "FIXED", parts: [{ value: 1000, dueDate: "2026-10-10" }, { value: 1000, dueDate: "2026-12-10" }] });
    expect(parts.id).toBeTruthy();
    const r1 = await run(now);
    expect(r1).toEqual({ created: 0, reminded: 3 });
    const titles = (await testDb.notification.findMany({ where: { kind: "PAYMENT_DUE" }, orderBy: { title: "asc" } })).map((n) => n.title);
    expect(titles).toEqual(["Overdue: Late Co ₹500 · Office", "Payment due in 3 days: Skyline Spaces ₹25,000 · Rent", "Payment due tomorrow: Studio ₹1,000 (Part 1 of 2) · Rent"]);
    expect(await run(now)).toEqual({ created: 0, reminded: 0 }); // idempotent

    // recurring bill whose next occurrence is missing (e.g. removed): recreated once the last paid due date is within remindDays
    const rec = await bill("Cloud", 1000, "2026-10-10", { plan: "RECURRING", remindDays: 1, rule: { freq: "MONTHLY", monthDay: 10 } });
    await testDb.expenseOccurrence.update({ where: { id: rec.occ.id }, data: { status: "PAID", paidAt: now, notifiedAt: now } });
    const r2 = await run(now);
    expect(r2.created).toBe(1);
    const next = await testDb.expenseOccurrence.findFirstOrThrow({ where: { expenseId: rec.id, status: "DUE" } });
    expect(next.dueDate.toISOString()).toBe("2026-11-09T18:30:00.000Z"); // 10 Nov IST
    expect((await run(now)).created).toBe(0);
  });
});
