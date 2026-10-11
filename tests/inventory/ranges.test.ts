import { describe, expect, it } from "vitest";
import {
  addDaysKey,
  bucketByPeriod,
  customRange,
  daysBetweenKeys,
  financialYearStartKey,
  isInventoryView,
  periodRange,
  shiftRange,
  stripGranularity,
  weekStartKey,
} from "@/server/inventory/ranges";

describe("inventory period ranges", () => {
  it("day / week (Mon–Sun) / month", () => {
    expect(periodRange("day", "2026-09-10")).toMatchObject({ from: "2026-09-10", to: "2026-09-10", label: "Thu 10 Sep 2026" });
    expect(periodRange("week", "2026-09-10")).toMatchObject({ from: "2026-09-07", to: "2026-09-13" });
    expect(periodRange("week", "2026-09-13")).toMatchObject({ from: "2026-09-07", to: "2026-09-13" }); // Sunday belongs to the week before
    expect(periodRange("month", "2026-02-10")).toMatchObject({ from: "2026-02-01", to: "2026-02-28", label: "Feb 2026" });
    expect(periodRange("month", "2028-02-10").to).toBe("2028-02-29");
  });

  it("quarter is the calendar quarter", () => {
    expect(periodRange("quarter", "2026-09-10")).toMatchObject({ from: "2026-07-01", to: "2026-09-30", label: "Q3 2026 (Jul–Sep)" });
    expect(periodRange("quarter", "2026-01-01")).toMatchObject({ from: "2026-01-01", to: "2026-03-31", label: "Q1 2026 (Jan–Mar)" });
    expect(periodRange("quarter", "2026-12-31")).toMatchObject({ from: "2026-10-01", to: "2026-12-31" });
  });

  it("year is the financial year (1 April – 31 March)", () => {
    expect(financialYearStartKey("2026-09-10")).toBe("2026-04-01");
    expect(financialYearStartKey("2026-03-31")).toBe("2025-04-01");
    expect(financialYearStartKey("2026-04-01")).toBe("2026-04-01");
    expect(periodRange("year", "2026-09-10")).toMatchObject({ from: "2026-04-01", to: "2027-03-31", label: "FY 2026–27 (Apr–Mar)" });
    expect(periodRange("year", "2027-02-01")).toMatchObject({ from: "2026-04-01", to: "2027-03-31" });
  });

  it("prev / next navigation for every view", () => {
    expect(shiftRange("day", periodRange("day", "2026-09-30"), 1)).toMatchObject({ from: "2026-10-01", to: "2026-10-01" });
    expect(shiftRange("week", periodRange("week", "2026-09-10"), -1)).toMatchObject({ from: "2026-08-31", to: "2026-09-06" });
    expect(shiftRange("month", periodRange("month", "2026-01-31"), 1)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(shiftRange("month", periodRange("month", "2026-01-15"), -1)).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(shiftRange("quarter", periodRange("quarter", "2026-11-05"), 1)).toMatchObject({ from: "2027-01-01", to: "2027-03-31" });
    expect(shiftRange("year", periodRange("year", "2026-09-10"), -1)).toMatchObject({ from: "2025-04-01", to: "2026-03-31" });
    expect(shiftRange("year", periodRange("year", "2026-09-10"), 1)).toMatchObject({ from: "2027-04-01", to: "2028-03-31" });
    // custom slides by its own length
    expect(shiftRange("custom", { from: "2026-09-01", to: "2026-09-10" }, 1)).toEqual({ from: "2026-09-11", to: "2026-09-20" });
    expect(shiftRange("custom", { from: "2026-09-01", to: "2026-09-10" }, -1)).toEqual({ from: "2026-08-22", to: "2026-08-31" });
  });

  it("custom range validates params and falls back to the coming week", () => {
    expect(customRange("2026-09-01", "2026-09-05", "2026-09-10")).toMatchObject({ from: "2026-09-01", to: "2026-09-05" });
    expect(customRange("2026-09-05", "2026-09-01", "2026-09-10")).toMatchObject({ from: "2026-09-10", to: "2026-09-16" }); // reversed
    expect(customRange("nope", undefined, "2026-09-10")).toMatchObject({ from: "2026-09-10", to: "2026-09-16" });
  });

  it("key helpers", () => {
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(weekStartKey("2026-09-07")).toBe("2026-09-07");
    expect(daysBetweenKeys("2026-09-01", "2026-09-10")).toBe(9);
    expect(isInventoryView("quarter")).toBe(true);
    expect(isInventoryView("today")).toBe(false);
  });

  it("strip granularity: quarter per week, year per month, long custom ranges bucketed too", () => {
    expect(stripGranularity("week", 7)).toBe("day");
    expect(stripGranularity("month", 30)).toBe("day");
    expect(stripGranularity("quarter", 92)).toBe("week");
    expect(stripGranularity("year", 365)).toBe("month");
    expect(stripGranularity("custom", 10)).toBe("day");
    expect(stripGranularity("custom", 60)).toBe("week");
    expect(stripGranularity("custom", 200)).toBe("month");
  });

  it("buckets day totals by week and by month in order", () => {
    const days = ["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-30", "2026-10-01"].map((date, i) => ({ date, capacityMinutes: 100 * (i + 1) }));
    const weeks = bucketByPeriod(days, "week");
    expect(weeks.map((w) => [w.key, w.from, w.to, w.items.length])).toEqual([
      ["2026-08-31", "2026-09-05", "2026-09-06", 2],
      ["2026-09-07", "2026-09-07", "2026-09-07", 1],
      ["2026-09-28", "2026-09-30", "2026-10-01", 2],
    ]);
    expect(weeks[0].label).toBe("31 Aug");
    const months = bucketByPeriod(days, "month");
    expect(months.map((m) => [m.key, m.label, m.items.length])).toEqual([
      ["2026-09-01", "Sep 26", 4],
      ["2026-10-01", "Oct 26", 1],
    ]);
    expect(bucketByPeriod(days, "day")).toHaveLength(5);
  });
});
