import { describe, it, expect } from "vitest";
import { defaultRule, describeRule, nextDate, nextDateKey, ordinal } from "@/server/finance/repeat";
import { repeatRuleSchema, type RepeatRuleInput } from "@/server/finance/schemas";

/** Repeat rules for recurring bills (ADR 0009) — calendar days in Asia/Kolkata, matching the prototype's nextDate/recurText. */
const rule = (r: RepeatRuleInput) => repeatRuleSchema.parse(r);
/** Walk the rule from its anchor: the anchor is the first due date, then `n - 1` more. */
function series(r: RepeatRuleInput, n: number) {
  const parsed = rule(r);
  const out = [parsed.anchorDate!];
  while (out.length < n) {
    const next = nextDateKey(parsed, out[out.length - 1], out.length);
    if (!next) break;
    out.push(next);
  }
  return out;
}

describe("repeat rules · nextDate", () => {
  it("daily every n days, weekdays skip the weekend", () => {
    expect(series({ freq: "DAILY", interval: 3, anchorDate: "2026-10-09" }, 3)).toEqual(["2026-10-09", "2026-10-12", "2026-10-15"]);
    // Fri 9 Oct 2026 → Mon 12 Oct
    expect(nextDateKey(rule({ freq: "WEEKDAYS" }), "2026-10-09", 1)).toBe("2026-10-12");
    expect(nextDateKey(rule({ freq: "WEEKDAYS" }), "2026-10-10", 1)).toBe("2026-10-12"); // from a Saturday
    expect(nextDateKey(rule({ freq: "WEEKDAYS" }), "2026-10-12", 1)).toBe("2026-10-13");
  });

  it("weekly on several days, and every 2 weeks counted in Monday-based weeks from the anchor", () => {
    // Thu 8 Oct 2026 anchor; Thu + Fri every week
    expect(series({ freq: "WEEKLY", weekdays: [5, 4], anchorDate: "2026-10-08" }, 5)).toEqual(["2026-10-08", "2026-10-09", "2026-10-15", "2026-10-16", "2026-10-22"]);
    // every 2 weeks: the week of 12 Oct is skipped
    expect(series({ freq: "WEEKLY", interval: 2, weekdays: [4, 5], anchorDate: "2026-10-08" }, 5)).toEqual(["2026-10-08", "2026-10-09", "2026-10-22", "2026-10-23", "2026-11-05"]);
    // Sunday belongs to the Monday-based week that started six days earlier
    expect(series({ freq: "WEEKLY", interval: 2, weekdays: [0, 1], anchorDate: "2026-10-12" }, 4)).toEqual(["2026-10-12", "2026-10-18", "2026-10-26", "2026-11-01"]);
  });

  it("monthly on a date clamps to the month length; 32 means the last day (leap years included)", () => {
    expect(series({ freq: "MONTHLY", monthDay: 31, anchorDate: "2026-01-31" }, 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(series({ freq: "MONTHLY", monthDay: 32, anchorDate: "2028-01-31" }, 3)).toEqual(["2028-01-31", "2028-02-29", "2028-03-31"]);
    expect(series({ freq: "MONTHLY", monthDay: 30, anchorDate: "2026-11-30" }, 4)).toEqual(["2026-11-30", "2026-12-30", "2027-01-30", "2027-02-28"]);
    // every 3 months from the anchor month; a first due date before the chosen day lands later in the same month
    expect(series({ freq: "MONTHLY", interval: 3, monthDay: 15, anchorDate: "2026-01-15" }, 3)).toEqual(["2026-01-15", "2026-04-15", "2026-07-15"]);
    expect(nextDateKey(rule({ freq: "MONTHLY", monthDay: 32, anchorDate: "2026-10-09" }), "2026-10-09", 1)).toBe("2026-10-31");
  });

  it("monthly on the nth weekday, including the last one (nth = 5) and months without a 5th", () => {
    // last Friday: 30 Oct 2026, 27 Nov 2026, 25 Dec 2026
    expect(series({ freq: "MONTHLY", monthMode: "NTH", nth: 5, nthWeekday: 5, anchorDate: "2026-10-30" }, 3)).toEqual(["2026-10-30", "2026-11-27", "2026-12-25"]);
    // first Monday: 2 Nov 2026, 7 Dec 2026
    expect(series({ freq: "MONTHLY", monthMode: "NTH", nth: 1, nthWeekday: 1, anchorDate: "2026-10-05" }, 3)).toEqual(["2026-10-05", "2026-11-02", "2026-12-07"]);
    // fourth Thursday
    expect(nextDateKey(rule({ freq: "MONTHLY", monthMode: "NTH", nth: 4, nthWeekday: 4, anchorDate: "2026-10-22" }), "2026-10-22", 1)).toBe("2026-11-26");
  });

  it("yearly, with 29 February falling back to the 28th outside leap years", () => {
    expect(series({ freq: "YEARLY", yearMonth: 4, yearDay: 1, anchorDate: "2026-04-01" }, 3)).toEqual(["2026-04-01", "2027-04-01", "2028-04-01"]);
    expect(series({ freq: "YEARLY", yearMonth: 2, yearDay: 29, anchorDate: "2028-02-29" }, 3)).toEqual(["2028-02-29", "2029-02-28", "2030-02-28"]);
    expect(series({ freq: "YEARLY", interval: 2, yearMonth: 10, yearDay: 9, anchorDate: "2026-10-09" }, 3)).toEqual(["2026-10-09", "2028-10-09", "2030-10-09"]);
  });

  it("ends after a count or on an until date", () => {
    const counted = rule({ freq: "WEEKLY", weekdays: [4, 5], endsType: "COUNT", endsCount: 3, anchorDate: "2026-10-08" });
    expect(nextDateKey(counted, "2026-10-15", 2)).toBe("2026-10-16");
    expect(nextDateKey(counted, "2026-10-16", 3)).toBeNull();
    expect(series({ freq: "WEEKLY", weekdays: [4, 5], endsType: "COUNT", endsCount: 3, anchorDate: "2026-10-08" }, 10)).toHaveLength(3);
    const until = rule({ freq: "DAILY", endsType: "UNTIL", endsUntil: "2026-10-11", anchorDate: "2026-10-09" });
    expect(nextDateKey(until, "2026-10-10", 2)).toBe("2026-10-11"); // the until day itself is included
    expect(nextDateKey(until, "2026-10-11", 3)).toBeNull();
    expect(nextDateKey(rule({ freq: "MONTHLY", monthDay: 1, endsType: "UNTIL", endsUntil: "2026-12-15", anchorDate: "2026-11-01" }), "2026-12-01", 2)).toBeNull();
  });

  it("nextDate reads the instant as an Asia/Kolkata calendar day and returns the start of the next due day there", () => {
    // 20:00 UTC on 9 Oct is already 10 Oct in India
    const next = nextDate(rule({ freq: "DAILY" }), new Date("2026-10-09T20:00:00Z"), 1, "Asia/Kolkata");
    expect(next?.toISOString()).toBe("2026-10-10T18:30:00.000Z"); // 11 Oct 00:00 IST
    expect(nextDate(rule({ freq: "DAILY", endsType: "COUNT", endsCount: 1 }), new Date(), 1)).toBeNull();
  });

  it("schema validates weekly days, count and until", () => {
    expect(repeatRuleSchema.safeParse({ freq: "WEEKLY", weekdays: [] }).success).toBe(false);
    expect(repeatRuleSchema.safeParse({ freq: "DAILY", endsType: "COUNT" }).success).toBe(false);
    expect(repeatRuleSchema.safeParse({ freq: "DAILY", endsType: "UNTIL", endsUntil: "9 Oct" }).success).toBe(false);
    expect(repeatRuleSchema.safeParse({ freq: "MONTHLY", monthDay: 33 }).success).toBe(false);
  });
});

describe("repeat rules · describeRule", () => {
  it("matches the prototype's wording", () => {
    expect(describeRule(rule({ freq: "WEEKLY", weekdays: [5, 4], endsType: "COUNT", endsCount: 10 }))).toBe("Every Thu, Fri · 10 times");
    expect(describeRule(rule({ freq: "MONTHLY", monthDay: 32 }))).toBe("Every month on the last day");
    expect(describeRule(rule({ freq: "WEEKDAYS" }))).toBe("Every weekday (Mon–Fri)");
    expect(describeRule(rule({ freq: "DAILY" }))).toBe("Every day");
    expect(describeRule(rule({ freq: "DAILY", interval: 2 }))).toBe("Every 2 days");
    expect(describeRule(rule({ freq: "WEEKLY", interval: 2, weekdays: [0, 1] }))).toBe("Every 2 weeks on Mon, Sun");
    expect(describeRule(rule({ freq: "MONTHLY", interval: 3, monthDay: 1 }))).toBe("Every 3 months on the 1st");
    expect(describeRule(rule({ freq: "MONTHLY", monthDay: 22 }))).toBe("Every month on the 22nd");
    expect(describeRule(rule({ freq: "MONTHLY", monthMode: "NTH", nth: 5, nthWeekday: 5 }))).toBe("Every month on the last Fri");
    expect(describeRule(rule({ freq: "MONTHLY", monthMode: "NTH", nth: 2, nthWeekday: 1 }))).toBe("Every month on the second Mon");
    expect(describeRule(rule({ freq: "YEARLY", yearMonth: 3, yearDay: 5 }))).toBe("Every year on 5 Mar");
    expect(describeRule(rule({ freq: "DAILY", endsType: "UNTIL", endsUntil: "2026-12-05" }))).toBe("Every day · until 05 Dec");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
  });

  it("defaultRule starts weekly on the first due date's weekday", () => {
    const r = defaultRule("2026-10-09");
    expect(r).toMatchObject({ freq: "WEEKLY", weekdays: [5], monthDay: 9, nth: 2, nthWeekday: 5, yearMonth: 10, yearDay: 9, anchorDate: "2026-10-09" });
    expect(describeRule(r)).toBe("Every Fri");
  });
});
