import { describe, it, expect } from "vitest";
import { isRuleActive, nextOccurrence, nextOccurrenceAfter, shiftedDueDate } from "@/server/finance/recurrence";

const at = (s: string) => new Date(s);

describe("recurrence math", () => {
  it("daily / custom add interval days and keep time-of-day", () => {
    expect(nextOccurrence(at("2026-09-10T04:30:00Z"), { frequency: "DAILY", interval: 1 })).toEqual(at("2026-09-11T04:30:00Z"));
    expect(nextOccurrence(at("2026-09-10T04:30:00Z"), { frequency: "CUSTOM", interval: 10 })).toEqual(at("2026-09-20T04:30:00Z"));
  });
  it("monthly clamps to month end", () => {
    expect(nextOccurrence(at("2026-01-31T00:00:00Z"), { frequency: "MONTHLY", interval: 1 })).toEqual(at("2026-02-28T00:00:00Z"));
    expect(nextOccurrence(at("2026-01-15T00:00:00Z"), { frequency: "MONTHLY", interval: 3 })).toEqual(at("2026-04-15T00:00:00Z"));
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
