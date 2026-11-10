import { describe, expect, it } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { completeRule, defaultRule, describeRule, nextDate, presetActive, repeatPresets, type RepeatRule } from "@/server/tasks/repeat-rule";
import { nextRunAt, repeatRuleData, toRepeatRule } from "@/server/tasks/recurrence";

const TZ = "Asia/Kolkata";
/** 2026-10-09 is a Friday. */
const FRI = "2026-10-09";
const rule = (o: Partial<RepeatRule> & Pick<RepeatRule, "freq">, anchor = FRI) => completeRule({ anchor, ...o }, anchor);
/** Follow a rule `n` times from its anchor (doneCount grows like the job's). */
function series(r: RepeatRule, n: number): string[] {
  const out = [r.anchor!];
  while (out.length < n) {
    const next = nextDate(r, out[out.length - 1], out.length);
    if (!next) break;
    out.push(next);
  }
  return out;
}

describe("nextDate (prototype parity, company-tz calendar days)", () => {
  it("DAILY steps `interval` days", () => {
    expect(nextDate(rule({ freq: "DAILY" }), FRI)).toBe("2026-10-10");
    expect(nextDate(rule({ freq: "DAILY", interval: 3 }), FRI)).toBe("2026-10-12");
    expect(nextDate(rule({ freq: "DAILY" }), "2026-12-31")).toBe("2027-01-01");
  });

  it("WEEKDAYS skips Saturday and Sunday", () => {
    expect(nextDate(rule({ freq: "WEEKDAYS" }), FRI)).toBe("2026-10-12");
    expect(nextDate(rule({ freq: "WEEKDAYS" }), "2026-10-12")).toBe("2026-10-13");
    expect(nextDate(rule({ freq: "WEEKDAYS" }), "2026-10-10")).toBe("2026-10-12"); // from a Saturday
  });

  it("WEEKLY on the anchor's weekday, and on several weekdays", () => {
    expect(series(rule({ freq: "WEEKLY", days: [5] }), 3)).toEqual([FRI, "2026-10-16", "2026-10-23"]);
    const mwf = rule({ freq: "WEEKLY", days: [1, 3, 5] }, "2026-10-05");
    expect(series(mwf, 5)).toEqual(["2026-10-05", "2026-10-07", FRI, "2026-10-12", "2026-10-14"]);
  });

  it("every 2 weeks counts Monday-based weeks from the anchor", () => {
    expect(series(rule({ freq: "WEEKLY", interval: 2, days: [5] }), 4)).toEqual([FRI, "2026-10-23", "2026-11-06", "2026-11-20"]);
    // Mon + Fri every other week: after Friday of week 0 comes Monday of week 2
    const mf = rule({ freq: "WEEKLY", interval: 2, days: [1, 5] }, "2026-10-05");
    expect(series(mf, 4)).toEqual(["2026-10-05", FRI, "2026-10-19", "2026-10-23"]);
    // a late completion (day in an "off" week) still lands on the next on-week
    expect(nextDate(mf, "2026-10-13")).toBe("2026-10-19");
  });

  it("MONTHLY on a date clamps to short months; 32 = last day", () => {
    expect(series(rule({ freq: "MONTHLY", monthDay: 31 }, "2026-01-31"), 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(series(rule({ freq: "MONTHLY", monthDay: 32 }, "2026-11-30"), 5)).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"]);
    expect(series(rule({ freq: "MONTHLY", monthDay: 30 }, "2026-10-30"), 3)).toEqual(["2026-10-30", "2026-11-30", "2026-12-30"]);
  });

  it("leap years: last day of February and 29 February yearly", () => {
    expect(nextDate(rule({ freq: "MONTHLY", monthDay: 32 }, "2028-01-31"), "2028-01-31")).toBe("2028-02-29");
    expect(nextDate(rule({ freq: "MONTHLY", monthDay: 29 }, "2027-01-29"), "2027-01-29")).toBe("2027-02-28");
    const feb29 = rule({ freq: "YEARLY", yMonth: 1, yDay: 29 }, "2028-02-29");
    expect(series(feb29, 4)).toEqual(["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28"]);
    expect(nextDate(feb29, "2031-02-28")).toBe("2032-02-29");
  });

  it("every 3 months keeps the anchor's phase", () => {
    expect(series(rule({ freq: "MONTHLY", interval: 3, monthDay: 9 }), 4)).toEqual([FRI, "2027-01-09", "2027-04-09", "2027-07-09"]);
  });

  it("MONTHLY on the nth / last weekday", () => {
    const lastFri = rule({ freq: "MONTHLY", monthMode: "NTH", nth: 5, nthDay: 5 }, "2026-10-30");
    expect(series(lastFri, 4)).toEqual(["2026-10-30", "2026-11-27", "2026-12-25", "2027-01-29"]);
    const firstMon = rule({ freq: "MONTHLY", monthMode: "NTH", nth: 1, nthDay: 1 }, "2026-10-05");
    expect(series(firstMon, 2)).toEqual(["2026-10-05", "2026-11-02"]);
    // a fourth Friday always exists; the anchor month's own occurrence counts when it is still ahead
    expect(nextDate(rule({ freq: "MONTHLY", monthMode: "NTH", nth: 4, nthDay: 5 }), FRI)).toBe("2026-10-23");
  });

  it("YEARLY on a month/day, every N years", () => {
    expect(nextDate(rule({ freq: "YEARLY", yMonth: 9, yDay: 9 }), FRI)).toBe("2027-10-09");
    expect(nextDate(rule({ freq: "YEARLY", interval: 2, yMonth: 9, yDay: 9 }), FRI)).toBe("2028-10-09");
  });

  it("ends: until a date (inclusive) and after N times", () => {
    const until = rule({ freq: "DAILY", ends: "UNTIL", until: "2026-10-11" });
    expect(series(until, 10)).toEqual([FRI, "2026-10-10", "2026-10-11"]);
    expect(nextDate(until, "2026-10-11")).toBeNull();
    const weeklyUntil = rule({ freq: "WEEKLY", days: [5], ends: "UNTIL", until: "2026-10-22" });
    expect(nextDate(weeklyUntil, "2026-10-16")).toBeNull();
    const three = rule({ freq: "WEEKLY", days: [5], ends: "COUNT", count: 3 });
    expect(series(three, 10)).toEqual([FRI, "2026-10-16", "2026-10-23"]);
    expect(nextDate(three, "2026-10-23", 3)).toBeNull();
  });
});

describe("describeRule / presets", () => {
  it("summaries match the prototype's recurText", () => {
    expect(describeRule(rule({ freq: "DAILY" }))).toBe("Every day");
    expect(describeRule(rule({ freq: "DAILY", interval: 2 }))).toBe("Every 2 days");
    expect(describeRule(rule({ freq: "WEEKDAYS" }))).toBe("Every weekday (Mon–Fri)");
    expect(describeRule(rule({ freq: "WEEKLY", days: [5] }))).toBe("Every Fri");
    expect(describeRule(rule({ freq: "WEEKLY", days: [0, 5, 1] }))).toBe("Every Mon, Fri, Sun");
    expect(describeRule(rule({ freq: "WEEKLY", interval: 2, days: [5] }))).toBe("Every 2 weeks on Fri");
    expect(describeRule(rule({ freq: "MONTHLY", monthDay: 9 }))).toBe("Every month on the 9th");
    expect(describeRule(rule({ freq: "MONTHLY", monthDay: 32 }))).toBe("Every month on the last day");
    expect(describeRule(rule({ freq: "MONTHLY", interval: 3, monthDay: 22 }))).toBe("Every 3 months on the 22nd");
    expect(describeRule(rule({ freq: "MONTHLY", monthMode: "NTH", nth: 5, nthDay: 5 }))).toBe("Every month on the last Fri");
    expect(describeRule(rule({ freq: "YEARLY", yMonth: 9, yDay: 9 }))).toBe("Every year on 9 Oct");
    expect(describeRule(rule({ freq: "DAILY", ends: "COUNT", count: 5 }))).toBe("Every day · 5 times");
    expect(describeRule(rule({ freq: "DAILY", ends: "UNTIL", until: "2026-12-05" }))).toBe("Every day · until 05 Dec");
  });

  it("presets for a Friday the 9th, and which one is on", () => {
    const p = repeatPresets(FRI);
    expect(p.map((x) => x.label)).toEqual(["Every day", "Every weekday", "Every Fri", "Every 2 weeks", "Every month on the 9th", "Every month, last day", "Every 3 months", "Every year"]);
    const d = defaultRule(FRI);
    expect(describeRule(d)).toBe("Every Fri");
    expect(p.filter((x) => presetActive(d, x.patch)).map((x) => x.label)).toEqual(["Every Fri"]);
  });
});

describe("database mapping (recurrence.ts)", () => {
  const ist = (s: string) => fromZonedTime(s, TZ);
  const legacy = { frequency: "WEEKLY" as const, interval: 1, byWeekday: [] as number[], endDate: null };

  it("round-trips a rule through the RecurrenceRule columns", () => {
    for (const r of [
      rule({ freq: "WEEKDAYS" }),
      rule({ freq: "WEEKLY", interval: 2, days: [1, 5], ends: "COUNT", count: 4 }),
      rule({ freq: "MONTHLY", monthDay: 32, ends: "UNTIL", until: "2027-06-30" }),
      rule({ freq: "MONTHLY", monthMode: "NTH", nth: 5, nthDay: 5 }),
      rule({ freq: "YEARLY", yMonth: 1, yDay: 29 }),
    ]) {
      const back = toRepeatRule(repeatRuleData(r, TZ), "2000-01-01", TZ);
      expect(describeRule(back)).toBe(describeRule(r));
      expect(nextDate(back, FRI, 1)).toBe(nextDate(r, FRI, 1));
    }
  });

  it("legacy rows are mapped on read (weekly on the occurrence's weekday, monthly on its date)", () => {
    expect(describeRule(toRepeatRule(legacy, FRI, TZ))).toBe("Every Fri");
    expect(describeRule(toRepeatRule({ ...legacy, frequency: "MONTHLY" }, FRI, TZ))).toBe("Every month on the 9th");
    expect(describeRule(toRepeatRule({ ...legacy, frequency: "CUSTOM", byWeekday: [2] }, FRI, TZ))).toBe("Every Tue");
  });

  it("nextRunAt keeps the time of day in the company timezone and honours the count", () => {
    const data = repeatRuleData(rule({ freq: "MONTHLY", monthMode: "NTH", nth: 5, nthDay: 5, ends: "COUNT", count: 2 }, "2026-10-30"), TZ);
    const first = ist("2026-10-30T15:30:00");
    expect(nextRunAt(data, first, TZ, 1)?.toISOString()).toBe(ist("2026-11-27T15:30:00").toISOString());
    expect(nextRunAt(data, ist("2026-11-27T15:30:00"), TZ, 2)).toBeNull();
    // 00:30 IST is the previous UTC day: the calendar day still comes from Asia/Kolkata
    const daily = repeatRuleData(rule({ freq: "WEEKDAYS" }), TZ);
    expect(nextRunAt(daily, ist("2026-10-09T00:30:00"), TZ)?.toISOString()).toBe(ist("2026-10-12T00:30:00").toISOString());
  });
});
