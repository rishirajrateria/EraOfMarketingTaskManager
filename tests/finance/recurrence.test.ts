import { describe, it, expect } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { anchoredMonthDate, isRuleActive, nextOccurrence, nextOccurrenceAfter, shiftedDueDate } from "@/server/finance/recurrence";

const at = (s: string) => new Date(s);
const TZ = "Asia/Kolkata";
const local = (d: Date) => formatInTimeZone(d, TZ, "yyyy-MM-dd HH:mm");

describe("recurrence math", () => {
  it("daily / custom add interval days and keep time-of-day", () => {
    expect(nextOccurrence(at("2026-09-10T04:30:00Z"), { frequency: "DAILY", interval: 1 })).toEqual(at("2026-09-11T04:30:00Z"));
    expect(nextOccurrence(at("2026-09-10T04:30:00Z"), { frequency: "CUSTOM", interval: 10 })).toEqual(at("2026-09-20T04:30:00Z"));
  });
  it("monthly clamps to month end", () => {
    expect(nextOccurrence(at("2026-01-31T00:00:00Z"), { frequency: "MONTHLY", interval: 1 })).toEqual(at("2026-02-28T00:00:00Z"));
    expect(nextOccurrence(at("2026-01-15T00:00:00Z"), { frequency: "MONTHLY", interval: 3 })).toEqual(at("2026-04-15T00:00:00Z"));
    expect(nextOccurrence(at("2026-01-15T00:00:00Z"), { frequency: "MONTHLY", interval: 1, monthAnchor: "NONE" })).toEqual(at("2026-02-15T00:00:00Z"));
  });
  it("month anchors land on the 1st / last day of the next month at local midnight (ADR 0005)", () => {
    // 9 Oct 2026 10:00 IST → START: 1 Nov 2026 00:00 IST; END: 30 Nov 2026 00:00 IST
    const from = at("2026-10-09T04:30:00Z");
    expect(local(nextOccurrence(from, { frequency: "MONTHLY", interval: 1, monthAnchor: "START" }, TZ))).toBe("2026-11-01 00:00");
    expect(local(nextOccurrence(from, { frequency: "MONTHLY", interval: 1, monthAnchor: "END" }, TZ))).toBe("2026-11-30 00:00");
    expect(nextOccurrence(from, { frequency: "MONTHLY", interval: 1, monthAnchor: "START" }, TZ)).toEqual(at("2026-10-31T18:30:00Z"));
    // February and leap years
    expect(local(anchoredMonthDate(at("2028-01-31T12:00:00Z"), "END", 1, TZ))).toBe("2028-02-29 00:00");
    expect(local(anchoredMonthDate(at("2026-12-31T20:00:00Z"), "START", 1, TZ))).toBe("2027-02-01 00:00"); // 1 Jan IST already
    expect(local(anchoredMonthDate(at("2026-12-31T20:00:00Z"), "START", 1, "UTC"))).toBe("2027-01-01 05:30");
    expect(local(anchoredMonthDate(at("2026-10-09T04:30:00Z"), "END", 2, TZ))).toBe("2026-12-31 00:00");
    // catch-up keeps the anchor
    const next = nextOccurrenceAfter(at("2026-01-31T18:30:00Z"), { frequency: "MONTHLY", interval: 1, monthAnchor: "END" }, at("2026-10-09T00:00:00Z"), TZ);
    expect(local(next)).toBe("2026-10-31 00:00");
  });
  it("weekly without weekdays adds interval weeks", () => {
    expect(nextOccurrence(at("2026-09-10T00:00:00Z"), { frequency: "WEEKLY", interval: 2 })).toEqual(at("2026-09-24T00:00:00Z"));
  });
  it("weekly with byWeekday picks the next matching weekday", () => {
    // 2026-09-10 is a Thursday (4); next Monday(1)/Wednesday(3) is Mon 14 Sep
    expect(nextOccurrence(at("2026-09-10T00:00:00Z"), { frequency: "WEEKLY", interval: 1, byWeekday: [1, 3] })).toEqual(at("2026-09-14T00:00:00Z"));
    expect(nextOccurrence(at("2026-09-14T00:00:00Z"), { frequency: "WEEKLY", interval: 1, byWeekday: [1, 3] })).toEqual(at("2026-09-16T00:00:00Z"));
  });
  it("catch-up skips missed occurrences without duplicating", () => {
    const next = nextOccurrenceAfter(at("2026-01-01T00:00:00Z"), { frequency: "MONTHLY", interval: 1 }, at("2026-09-10T00:00:00Z"));
    expect(next).toEqual(at("2026-10-01T00:00:00Z"));
  });
  it("rule activity honours stopped and endDate", () => {
    const now = at("2026-09-10T00:00:00Z");
    expect(isRuleActive({ frequency: "DAILY" }, now)).toBe(true);
    expect(isRuleActive({ frequency: "DAILY", stopped: true }, now)).toBe(false);
    expect(isRuleActive({ frequency: "DAILY", endDate: at("2026-09-01T00:00:00Z") }, now)).toBe(false);
    expect(isRuleActive({ frequency: "DAILY", endDate: at("2026-12-01T00:00:00Z") }, now)).toBe(true);
  });
  it("shifted due date keeps the template offset, defaults to 15 days", () => {
    expect(shiftedDueDate(at("2026-01-01T00:00:00Z"), at("2026-01-11T00:00:00Z"), at("2026-02-01T00:00:00Z"))).toEqual(at("2026-02-11T00:00:00Z"));
    expect(shiftedDueDate(at("2026-01-01T00:00:00Z"), null, at("2026-02-01T00:00:00Z"))).toEqual(at("2026-02-16T00:00:00Z"));
  });
});
