import { describe, it, expect } from "vitest";
import type { CompanySettings } from "@prisma/client";
import { computeCapacityMinutes, dayKeysBetween, fromDbDate, sellable, sumTotals, toDbDate, toWorkingConfig } from "@/server/inventory/compute";
import { DEFAULT_WORKING } from "@/lib/working-time";

/** Minimal CompanySettings row for toWorkingConfig (other columns are irrelevant to capacity). */
const SETTINGS_ROW = {
  timezone: "Asia/Kolkata",
  workStartMinutes: 600,
  workEndMinutes: 1140,
  lunchStartMinutes: 810,
  lunchEndMinutes: 870,
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: [new Date("2026-09-15T00:00:00Z")],
};

const user = { dailyCapacityMinutes: null, workingDays: [1, 2, 3, 4, 5, 6] };
const monday = toDbDate("2026-09-14");
const sunday = toDbDate("2026-09-13");
const base = { user, settings: DEFAULT_WORKING, onLeave: false, isHoliday: false };

describe("computeCapacityMinutes", () => {
  it("is 8 productive hours on a normal working day", () => {
    expect(computeCapacityMinutes({ ...base, date: monday })).toBe(480);
  });
  it("assumes present when no attendance row (future days)", () => {
    expect(computeCapacityMinutes({ ...base, date: monday, attendanceStatus: null })).toBe(480);
    expect(computeCapacityMinutes({ ...base, date: monday, attendanceStatus: "PRESENT" })).toBe(480);
  });
  it("uses the Settings half-day minutes on HALF_DAY (default 240), regardless of the user's full-day override", () => {
    expect(computeCapacityMinutes({ ...base, date: monday, attendanceStatus: "HALF_DAY" })).toBe(240);
    const settings = { ...DEFAULT_WORKING, halfDayMinutes: 180 };
    expect(computeCapacityMinutes({ ...base, settings, date: monday, attendanceStatus: "HALF_DAY" })).toBe(180);
    expect(computeCapacityMinutes({ ...base, settings, date: monday, attendanceStatus: "HALF_DAY", user: { dailyCapacityMinutes: 300, workingDays: [1, 2, 3, 4, 5, 6] } })).toBe(180);
    // never more than the person's full day
    expect(computeCapacityMinutes({ ...base, settings, date: monday, attendanceStatus: "HALF_DAY", user: { dailyCapacityMinutes: 120, workingDays: [1, 2, 3, 4, 5, 6] } })).toBe(120);
    expect(computeCapacityMinutes({ ...base, settings, date: monday, attendanceStatus: "PRESENT" })).toBe(480);
  });
  it("toWorkingConfig carries halfDayMinutes from settings", () => {
    const cfg = toWorkingConfig({ ...SETTINGS_ROW, halfDayMinutes: 200 } as unknown as CompanySettings);
    expect(cfg.halfDayMinutes).toBe(200);
    expect(cfg.holidays).toEqual(["2026-09-15"]);
  });
  it("is 0 for absent / leave / holiday statuses", () => {
    for (const s of ["ABSENT", "LEAVE", "HOLIDAY"] as const) {
      expect(computeCapacityMinutes({ ...base, date: monday, attendanceStatus: s })).toBe(0);
    }
  });
  it("is 0 on approved leave, company holiday and non-working days", () => {
    expect(computeCapacityMinutes({ ...base, date: monday, onLeave: true })).toBe(0);
    expect(computeCapacityMinutes({ ...base, date: monday, isHoliday: true })).toBe(0);
    expect(computeCapacityMinutes({ ...base, date: sunday })).toBe(0);
  });
  it("respects the user's capacity override and working days", () => {
    expect(computeCapacityMinutes({ ...base, date: monday, user: { dailyCapacityMinutes: 300, workingDays: [1, 2, 3, 4, 5, 6] } })).toBe(300);
    expect(computeCapacityMinutes({ ...base, date: monday, user: { dailyCapacityMinutes: null, workingDays: [2, 3, 4] } })).toBe(0);
  });
  it("evaluates the weekday in the company timezone", () => {
    // 2026-09-13T20:00Z is Sunday in UTC but already Monday 01:30 in Asia/Kolkata
    expect(computeCapacityMinutes({ ...base, date: new Date("2026-09-13T20:00:00Z") })).toBe(480);
  });
});

describe("date-only column helpers", () => {
  it("round-trips yyyy-MM-dd via UTC midnight", () => {
    const d = toDbDate("2026-09-10");
    expect(d.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(fromDbDate(d)).toBe("2026-09-10");
  });
  it("lists inclusive day keys in the timezone", () => {
    const keys = dayKeysBetween(new Date("2026-09-09T18:30:00Z"), new Date("2026-09-12T10:00:00Z"), "Asia/Kolkata");
    expect(keys).toEqual(["2026-09-10", "2026-09-11", "2026-09-12"]);
  });
});

describe("totals", () => {
  it("sellable never goes negative", () => {
    expect(sellable(480, 600)).toBe(0);
    expect(sellable(480, 120)).toBe(360);
  });
  it("sums rows", () => {
    expect(sumTotals([{ capacityMinutes: 480, assignedMinutes: 60, sellableMinutes: 420 }, { capacityMinutes: 240, assignedMinutes: 0, sellableMinutes: 240 }])).toEqual({
      capacityMinutes: 720,
      assignedMinutes: 60,
      sellableMinutes: 660,
    });
  });
});
