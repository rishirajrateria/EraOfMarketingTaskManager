import { describe, expect, it } from "vitest";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { nextRunAt } from "@/server/tasks/recurrence";

const TZ = "Asia/Kolkata";
const ist = (s: string) => fromZonedTime(s, TZ);
/** 2026-09-15 is a Tuesday (IST). */
const tue = ist("2026-09-15T10:00:00");

const rule = (o: Partial<{ frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM"; interval: number; byWeekday: number[]; endDate: Date | null }>) => ({
  frequency: o.frequency ?? "DAILY",
  interval: o.interval ?? 1,
  byWeekday: o.byWeekday ?? [],
  endDate: o.endDate ?? null,
});

describe("nextRunAt", () => {
  it("DAILY adds `interval` days", () => {
    expect(nextRunAt(rule({ frequency: "DAILY" }), tue, TZ)?.toISOString()).toBe(ist("2026-09-16T10:00:00").toISOString());
    expect(nextRunAt(rule({ frequency: "DAILY", interval: 3 }), tue, TZ)?.toISOString()).toBe(ist("2026-09-18T10:00:00").toISOString());
  });

  it("WEEKLY without byWeekday adds `interval` weeks", () => {
    expect(nextRunAt(rule({ frequency: "WEEKLY" }), tue, TZ)?.toISOString()).toBe(ist("2026-09-22T10:00:00").toISOString());
    expect(nextRunAt(rule({ frequency: "WEEKLY", interval: 2 }), tue, TZ)?.toISOString()).toBe(ist("2026-09-29T10:00:00").toISOString());
  });

  it("WEEKLY with byWeekday picks the next matching weekday in the company timezone", () => {
    // Mon(1) & Wed(3): after Tuesday → Wednesday 16th, after Wednesday → Monday 21st
    const r = rule({ frequency: "WEEKLY", byWeekday: [1, 3] });
    const wed = nextRunAt(r, tue, TZ)!;
    expect(wed.toISOString()).toBe(ist("2026-09-16T10:00:00").toISOString());
    expect(toZonedTime(wed, TZ).getDay()).toBe(3);
    const mon = nextRunAt(r, wed, TZ)!;
    expect(mon.toISOString()).toBe(ist("2026-09-21T10:00:00").toISOString());
    expect(toZonedTime(mon, TZ).getDay()).toBe(1);
  });

  it("WEEKLY byWeekday with the same weekday only → exactly one week later", () => {
    const r = rule({ frequency: "WEEKLY", byWeekday: [2] });
    expect(nextRunAt(r, tue, TZ)?.toISOString()).toBe(ist("2026-09-22T10:00:00").toISOString());
  });

  it("CUSTOM behaves like WEEKLY", () => {
    const r = rule({ frequency: "CUSTOM", byWeekday: [6] });
    expect(nextRunAt(r, tue, TZ)?.toISOString()).toBe(ist("2026-09-19T10:00:00").toISOString());
    expect(nextRunAt(rule({ frequency: "CUSTOM", interval: 1 }), tue, TZ)?.toISOString()).toBe(ist("2026-09-22T10:00:00").toISOString());
  });

  it("MONTHLY adds `interval` months", () => {
    expect(nextRunAt(rule({ frequency: "MONTHLY" }), tue, TZ)?.toISOString()).toBe(ist("2026-10-15T10:00:00").toISOString());
    expect(nextRunAt(rule({ frequency: "MONTHLY", interval: 2 }), tue, TZ)?.toISOString()).toBe(ist("2026-11-15T10:00:00").toISOString());
  });

  it("returns null once the next run would fall after endDate", () => {
    // endDate = 2026-09-15 (a date, midnight IST) — the day itself is still allowed (endDate + 1 day tolerance)
    const endSame = rule({ frequency: "DAILY", endDate: ist("2026-09-15T00:00:00") });
    expect(nextRunAt(endSame, tue, TZ)).toBeNull(); // next would be the 16th
    const endTomorrow = rule({ frequency: "DAILY", endDate: ist("2026-09-16T00:00:00") });
    expect(nextRunAt(endTomorrow, tue, TZ)).not.toBeNull(); // 16th 10:00 <= 17th 00:00
    const endPast = rule({ frequency: "WEEKLY", endDate: ist("2026-09-01T00:00:00") });
    expect(nextRunAt(endPast, tue, TZ)).toBeNull();
    const endMonthly = rule({ frequency: "MONTHLY", endDate: ist("2026-10-01T00:00:00") });
    expect(nextRunAt(endMonthly, tue, TZ)).toBeNull();
  });

  it("always returns a date strictly after `after`", () => {
    for (const f of ["DAILY", "WEEKLY", "MONTHLY"] as const) {
      const n = nextRunAt(rule({ frequency: f }), tue, TZ)!;
      expect(n.getTime()).toBeGreaterThan(tue.getTime());
    }
  });
});
