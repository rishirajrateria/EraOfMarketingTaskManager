import { describe, expect, it } from "vitest";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  DEFAULT_WORKING,
  findSlot,
  isWorkingDay,
  productiveMinutesPerDay,
  subtractIntervals,
  workingIntervalsForDay,
  clipMinutes,
  type Interval,
  type WorkingConfig,
} from "@/lib/working-time";

const TZ = "Asia/Kolkata";
/** IST wall-clock → UTC instant. 2026-09-15 is a Tuesday, 2026-09-13 a Sunday, 2026-09-12 a Saturday. */
const ist = (s: string) => fromZonedTime(s, TZ);
const wall = (d: Date) => toZonedTime(d, TZ);
const hhmm = (d: Date) => `${String(wall(d).getHours()).padStart(2, "0")}:${String(wall(d).getMinutes()).padStart(2, "0")}`;

describe("productiveMinutesPerDay", () => {
  it("is 8 hours for the SPEC §9.1 defaults (10:00–19:00 minus 13:30–14:30 lunch)", () => {
    expect(productiveMinutesPerDay(DEFAULT_WORKING)).toBe(480);
  });

  it("follows custom hours", () => {
    const c: WorkingConfig = { ...DEFAULT_WORKING, workStartMinutes: 9 * 60, workEndMinutes: 17 * 60, lunchStartMinutes: 12 * 60, lunchEndMinutes: 12 * 60 + 30 };
    expect(productiveMinutesPerDay(c)).toBe(450);
  });
});

describe("workingIntervalsForDay", () => {
  it("returns morning and afternoon blocks around lunch on a Tuesday", () => {
    const ivs = workingIntervalsForDay(ist("2026-09-15T12:00:00"), DEFAULT_WORKING);
    expect(ivs).toHaveLength(2);
    expect(ivs[0].start.toISOString()).toBe(ist("2026-09-15T10:00:00").toISOString());
    expect(ivs[0].end.toISOString()).toBe(ist("2026-09-15T13:30:00").toISOString());
    expect(ivs[1].start.toISOString()).toBe(ist("2026-09-15T14:30:00").toISOString());
    expect(ivs[1].end.toISOString()).toBe(ist("2026-09-15T19:00:00").toISOString());
    // 04:30Z–08:00Z and 09:00Z–13:30Z
    expect(ivs[0].start.toISOString()).toBe("2026-09-15T04:30:00.000Z");
  });

  it("returns [] on Sunday", () => {
    expect(isWorkingDay(ist("2026-09-13T12:00:00"), DEFAULT_WORKING)).toBe(false);
    expect(workingIntervalsForDay(ist("2026-09-13T12:00:00"), DEFAULT_WORKING)).toEqual([]);
  });

  it("returns [] on a company holiday and on an extraOff day (leave)", () => {
    const c: WorkingConfig = { ...DEFAULT_WORKING, holidays: ["2026-09-15"] };
    expect(workingIntervalsForDay(ist("2026-09-15T12:00:00"), c)).toEqual([]);
    expect(workingIntervalsForDay(ist("2026-09-15T12:00:00"), DEFAULT_WORKING, new Set(["2026-09-15"]))).toEqual([]);
    // the day after is unaffected
    expect(workingIntervalsForDay(ist("2026-09-16T12:00:00"), c)).toHaveLength(2);
  });

  it("returns a single block when there is no lunch break inside the working window", () => {
    const c: WorkingConfig = { ...DEFAULT_WORKING, lunchStartMinutes: 0, lunchEndMinutes: 0 };
    const ivs = workingIntervalsForDay(ist("2026-09-15T12:00:00"), c);
    expect(ivs).toHaveLength(1);
    expect(hhmm(ivs[0].start)).toBe("10:00");
    expect(hhmm(ivs[0].end)).toBe("19:00");
  });
});

describe("subtractIntervals", () => {
  const free: Interval[] = [{ start: ist("2026-09-15T10:00:00"), end: ist("2026-09-15T13:30:00") }];

  it("leaves free intervals untouched when busy does not overlap", () => {
    const out = subtractIntervals(free, [{ start: ist("2026-09-15T14:30:00"), end: ist("2026-09-15T15:00:00") }]);
    expect(out).toEqual(free);
  });

  it("splits a free interval around a busy block in the middle", () => {
    const out = subtractIntervals(free, [{ start: ist("2026-09-15T11:00:00"), end: ist("2026-09-15T12:00:00") }]);
    expect(out.map((i) => [hhmm(i.start), hhmm(i.end)])).toEqual([
      ["10:00", "11:00"],
      ["12:00", "13:30"],
    ]);
  });

  it("trims edges and removes fully covered intervals", () => {
    const head = subtractIntervals(free, [{ start: ist("2026-09-15T09:00:00"), end: ist("2026-09-15T11:00:00") }]);
    expect(head.map((i) => [hhmm(i.start), hhmm(i.end)])).toEqual([["11:00", "13:30"]]);
    const tail = subtractIntervals(free, [{ start: ist("2026-09-15T12:00:00"), end: ist("2026-09-15T20:00:00") }]);
    expect(tail.map((i) => [hhmm(i.start), hhmm(i.end)])).toEqual([["10:00", "12:00"]]);
    const all = subtractIntervals(free, [{ start: ist("2026-09-15T09:00:00"), end: ist("2026-09-15T20:00:00") }]);
    expect(all).toEqual([]);
  });

  it("applies several busy blocks cumulatively", () => {
    const out = subtractIntervals(free, [
      { start: ist("2026-09-15T10:30:00"), end: ist("2026-09-15T11:00:00") },
      { start: ist("2026-09-15T12:00:00"), end: ist("2026-09-15T12:30:00") },
    ]);
    expect(out.map((i) => [hhmm(i.start), hhmm(i.end)])).toEqual([
      ["10:00", "10:30"],
      ["11:00", "12:00"],
      ["12:30", "13:30"],
    ]);
  });

  it("clipMinutes sums only the part inside the window", () => {
    expect(clipMinutes(free, ist("2026-09-15T11:00:00"), ist("2026-09-15T12:00:00"))).toBe(60);
    expect(clipMinutes(free, ist("2026-09-15T09:00:00"), ist("2026-09-15T20:00:00"))).toBe(210);
  });
});

describe("findSlot", () => {
  const tue9 = ist("2026-09-15T09:00:00");

  it("splits a 240 min task across lunch: 10:00–13:30 + 14:30–15:00 (2 chunks)", () => {
    const slot = findSlot(tue9, 240, DEFAULT_WORKING, []);
    expect(slot).not.toBeNull();
    expect(hhmm(slot!.start)).toBe("10:00");
    expect(hhmm(slot!.end)).toBe("15:00");
    expect(slot!.chunks).toHaveLength(2);
    expect(slot!.chunks.map((c) => [hhmm(c.start), hhmm(c.end)])).toEqual([
      ["10:00", "13:30"],
      ["14:30", "15:00"],
    ]);
  });

  it("without allowSplit takes the first contiguous gap: 14:30–18:30", () => {
    const slot = findSlot(tue9, 240, DEFAULT_WORKING, [], { allowSplit: false });
    expect(slot).not.toBeNull();
    expect(hhmm(slot!.start)).toBe("14:30");
    expect(hhmm(slot!.end)).toBe("18:30");
    expect(slot!.chunks).toHaveLength(1);
  });

  it("starts at `from` when it falls inside a working interval", () => {
    const slot = findSlot(ist("2026-09-15T11:00:00"), 60, DEFAULT_WORKING, []);
    expect(hhmm(slot!.start)).toBe("11:00");
    expect(hhmm(slot!.end)).toBe("12:00");
  });

  it("skips busy blocks", () => {
    const busy: Interval[] = [{ start: ist("2026-09-15T10:00:00"), end: ist("2026-09-15T11:00:00") }];
    const slot = findSlot(tue9, 60, DEFAULT_WORKING, busy, { allowSplit: false });
    expect(hhmm(slot!.start)).toBe("11:00");
    expect(hhmm(slot!.end)).toBe("12:00");
    // a busy block that eats the whole morning pushes the task past lunch
    const morning: Interval[] = [{ start: ist("2026-09-15T10:00:00"), end: ist("2026-09-15T13:30:00") }];
    const pm = findSlot(tue9, 60, DEFAULT_WORKING, morning);
    expect(hhmm(pm!.start)).toBe("14:30");
    expect(hhmm(pm!.end)).toBe("15:30");
  });

  it("spans days, skipping Sunday: Saturday 18:00 + Monday 10:00", () => {
    const slot = findSlot(ist("2026-09-12T18:00:00"), 120, DEFAULT_WORKING, []);
    expect(slot).not.toBeNull();
    expect(slot!.start.toISOString()).toBe(ist("2026-09-12T18:00:00").toISOString());
    expect(slot!.end.toISOString()).toBe(ist("2026-09-14T11:00:00").toISOString());
    expect(slot!.chunks).toHaveLength(2);
    expect(slot!.chunks[1].start.toISOString()).toBe(ist("2026-09-14T10:00:00").toISOString());
  });

  it("rolls to the next working day when `from` is after hours", () => {
    const slot = findSlot(ist("2026-09-15T19:30:00"), 60, DEFAULT_WORKING, []);
    expect(slot!.start.toISOString()).toBe(ist("2026-09-16T10:00:00").toISOString());
  });

  it("returns null when there are no working days in the horizon", () => {
    const none: WorkingConfig = { ...DEFAULT_WORKING, workingDays: [] };
    expect(findSlot(tue9, 60, none, [])).toBeNull();
    // only Sunday within a 1-day horizon
    expect(findSlot(ist("2026-09-13T09:00:00"), 60, DEFAULT_WORKING, [], { maxDays: 1 })).toBeNull();
    // extraOff (leave) covering the whole horizon
    expect(findSlot(tue9, 60, DEFAULT_WORKING, [], { maxDays: 2, extraOff: new Set(["2026-09-15", "2026-09-16"]) })).toBeNull();
  });
});
