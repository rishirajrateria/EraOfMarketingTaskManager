import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();

async function load() {
  return import("@/server/admin/settings-actions");
}

const baseInput = {
  companyName: "Era Of Marketing Pvt Ltd",
  address: "Mumbai",
  gstNumber: "27ABCDE1234F1Z5",
  bankName: "HDFC",
  bankAccountName: "Era Of Marketing",
  bankAccountNumber: "1234567890",
  bankIfsc: "HDFC0000001",
  upiId: "eom@hdfc",
  workStartMinutes: 9 * 60,
  workEndMinutes: 18 * 60,
  lunchStartMinutes: 13 * 60,
  lunchEndMinutes: 13 * 60 + 30,
  workingDays: [1, 2, 3, 4, 5],
  holidays: ["2026-10-02", "2026-08-15", "2026-08-15"],
  timezone: "Asia/Kolkata",
  invoicePrefix: "EOM/26-27/",
  invoiceNextNumber: 42,
  receiptPrefix: "RCP-",
  receiptNextNumber: 7,
  invoiceTerms: "Net 30",
  invoiceEmailTemplate: "Hi {{client}}",
  defaultGstPercent: 12.5,
  notifyEmailDefault: true,
  notifyChatDefault: false,
  restartCreatesNewWorkspace: false,
  recurrenceCreatesNewWorkspace: true,
  halfDayMinutes: 5 * 60,
  expenseCategories: ["Travel", "Software", "Office"],
};

describe("company settings actions", () => {
  beforeEach(async () => {
    await resetDb();
    (await import("@/lib/settings")).invalidateSettingsCache(); // the 10 s cache must not leak between tests
  });

  it("round-trips every field and invalidates the cache", async () => {
    const { admin } = await seedBasics();
    session.set(admin);
    const actions = await load();
    const { getSettings } = await import("@/lib/settings");
    const { getSettingsDto } = await import("@/server/admin/queries");
    expect((await getSettings()).companyName).toBe("Era Of Marketing"); // warm the cache with defaults

    const res = await actions.updateSettings(baseInput);
    expect(res.ok).toBe(true);

    const s = await getSettings();
    expect(s.companyName).toBe(baseInput.companyName);
    expect(s.workStartMinutes).toBe(540);
    expect(s.lunchEndMinutes).toBe(810);
    expect(s.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(s.holidays.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-08-15", "2026-10-02"]);
    expect(Number(s.defaultGstPercent)).toBe(12.5);
    expect(s.invoiceNextNumber).toBe(42);
    expect(s.notifyEmailDefault).toBe(true);
    expect(s.notifyChatDefault).toBe(false);
    expect(s.restartCreatesNewWorkspace).toBe(false);
    expect(s.halfDayMinutes).toBe(300);
    expect(s.expenseCategories).toEqual(["Travel", "Software", "Office"]);

    const dto = await getSettingsDto();
    expect(dto).toMatchObject({ ...baseInput, holidays: ["2026-08-15", "2026-10-02"], hasLogo: false, logoUrl: null });

    const log = await testDb.auditLog.findFirst({ where: { entityType: "CompanySettings", action: "settings.update" } });
    expect(log?.actorId).toBe(admin.id);
  });

  it("validates working hours and rejects non-admins", async () => {
    const { admin, hr } = await seedBasics();
    const actions = await load();
    session.set(hr);
    expect((await actions.updateSettings(baseInput)).ok).toBe(false);

    session.set(admin);
    const badLunch = await actions.updateSettings({ ...baseInput, lunchEndMinutes: 20 * 60 });
    expect(badLunch.ok).toBe(false);
    if (!badLunch.ok) expect(badLunch.error).toMatch(/Lunch/);
    const badTz = await actions.updateSettings({ ...baseInput, timezone: "Mars/Olympus" });
    expect(badTz.ok).toBe(false);
    const badDay = await actions.updateSettings({ ...baseInput, holidays: ["15-08-2026"] });
    expect(badDay.ok).toBe(false);
    const longHalfDay = await actions.updateSettings({ ...baseInput, halfDayMinutes: 10 * 60 });
    expect(longHalfDay.ok).toBe(false);
    if (!longHalfDay.ok) expect(longHalfDay.error).toMatch(/Half day/);
  });

  it("ships default expense categories, de-duplicates edits and refuses an empty list", async () => {
    const { admin } = await seedBasics();
    session.set(admin);
    const actions = await load();
    const { getSettings } = await import("@/lib/settings");
    expect((await getSettings()).expenseCategories).toEqual(expect.arrayContaining(["Travel", "Software", "Office"]));
    expect((await getSettings()).halfDayMinutes).toBe(240);
    expect((await getSettings()).notifyChatDefault).toBe(false);

    const res = await actions.updateSettings({ ...baseInput, expenseCategories: [" Rent ", "rent", "Utilities", "Rent"] });
    expect(res.ok).toBe(true);
    expect((await getSettings()).expenseCategories).toEqual(["Rent", "Utilities"]);

    const empty = await actions.updateSettings({ ...baseInput, expenseCategories: [] });
    expect(empty.ok).toBe(false);
    const blank = await actions.updateSettings({ ...baseInput, expenseCategories: ["Travel", "  "] });
    expect(blank.ok).toBe(false);
  });

  it("uploads, streams and removes the logo", async () => {
    const { admin } = await seedBasics();
    session.set(admin);
    const actions = await load();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const fd = new FormData();
    fd.append("logo", new File([png], "logo.png", { type: "image/png" }));
    const up = await actions.uploadLogo(fd);
    expect(up.ok).toBe(true);
    if (up.ok) expect(up.data.logoUrl).toBe("/api/files/logo");

    const { GET } = await import("@/app/api/files/logo/route");
    const resp = await GET();
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await resp.arrayBuffer())).toEqual(png);

    const bad = new FormData();
    bad.append("logo", new File([png], "x.txt", { type: "text/plain" }));
    expect((await actions.uploadLogo(bad)).ok).toBe(false);

    expect((await actions.removeLogo()).ok).toBe(true);
    expect((await GET()).status).toBe(404);
    const s = await testDb.companySettings.findUniqueOrThrow({ where: { id: "default" } });
    expect(s.logoUrl).toBeNull();
  });
});
