import { describe, expect, it } from "vitest";
import { buildHourCells, hourStarts, hourlyStatus, minutesLabel, toBusyBlock } from "@/server/inventory/hourly";
import { DEFAULT_WORKING } from "@/lib/working-time";
import { zonedStartOfDay } from "@/lib/time";

const task = (id: string, start: string, end: string | null, allocated = 60) => ({
  id,
  title: `Task ${id}`,
  type: "WORK" as const,
  scheduledStart: new Date(start),
  scheduledEnd: end ? new Date(end) : null,
  allocatedMinutes: allocated,
});
const dayStart = zonedStartOfDay(new Date("2026-09-14T05:00:00Z"), "Asia/Kolkata"); // Mon 00:00 IST

describe("hourly helpers", () => {
  it("lists working-hour starts from settings", () => {
    expect(hourStarts(DEFAULT_WORKING)).toEqual([600, 660, 720, 780, 840, 900, 960, 1020, 1080]);
    expect(hourStarts({ workStartMinutes: 540, workEndMinutes: 750 })).toEqual([540, 600, 660, 720]);
    expect(minutesLabel(600)).toBe("10:00");
    expect(minutesLabel(1085)).toBe("18:05");
  });

  it("converts a task's scheduled window to minutes-of-day, clipped to the day", () => {
    expect(toBusyBlock(task("a", "2026-09-14T04:30:00Z", "2026-09-14T06:30:00Z"), dayStart)).toMatchObject({ start: 600, end: 720 }); // 10:00–12:00 IST
    expect(toBusyBlock(task("b", "2026-09-14T12:00:00Z", null, 90), dayStart)).toMatchObject({ start: 1050, end: 1140 }); // 17:30 + 90m
    expect(toBusyBlock(task("c", "2026-09-13T12:00:00Z", "2026-09-14T05:00:00Z"), dayStart)).toMatchObject({ start: 0, end: 630 }); // overnight
    expect(toBusyBlock(task("d", "2026-09-15T04:30:00Z", "2026-09-15T05:30:00Z"), dayStart)).toBeNull(); // next day
    expect(toBusyBlock({ ...task("e", "2026-09-14T04:30:00Z", null), scheduledStart: null }, dayStart)).toBeNull();
  });

  it("derives the day status with holiday > leave > absent > non-working > half day", () => {
    const base = { attendanceStatus: null, onLeave: false, isHoliday: false, workingDay: true };
    expect(hourlyStatus(base)).toBe("PRESENT");
    expect(hourlyStatus({ ...base, attendanceStatus: "HALF_DAY" })).toBe("HALF_DAY");
    expect(hourlyStatus({ ...base, workingDay: false })).toBe("OFF");
    expect(hourlyStatus({ ...base, attendanceStatus: "ABSENT" })).toBe("ABSENT");
    expect(hourlyStatus({ ...base, onLeave: true, attendanceStatus: "PRESENT" })).toBe("LEAVE");
    expect(hourlyStatus({ ...base, isHoliday: true, onLeave: true })).toBe("HOLIDAY");
  });

  it("marks the right hours busy, greys lunch, and turns the whole day off on leave", () => {
    const hours = hourStarts(DEFAULT_WORKING);
    const busy = [
      { start: 600, end: 720, task: { id: "a", title: "Logo", type: "WORK" as const } },
      { start: 930, end: 1000, task: { id: "b", title: "Standup", type: "MEETING" as const } },
    ];
    const cells = buildHourCells(hours, DEFAULT_WORKING, busy, { status: "PRESENT" });
    expect(cells.map((c) => c.kind)).toEqual(["assigned", "assigned", "free", "lunch", "lunch", "assigned", "assigned", "free", "free"]);
    expect(cells[0].tasks).toEqual([{ id: "a", title: "Logo", type: "WORK" }]);
    expect(cells[5].tasks.map((t) => t.title)).toEqual(["Standup"]);
    // a task over lunch still shows as assigned
    const overLunch = buildHourCells(hours, DEFAULT_WORKING, [{ start: 780, end: 900, task: busy[0].task }], { status: "PRESENT" });
    expect(overLunch.map((c) => c.kind).slice(3, 5)).toEqual(["assigned", "assigned"]);
    for (const status of ["LEAVE", "HOLIDAY", "ABSENT", "OFF"] as const) {
      expect(buildHourCells(hours, DEFAULT_WORKING, busy, { status }).every((c) => c.kind === "off")).toBe(true);
    }
  });

  it("half day with recorded times only occupies the hours between check-in and check-out", () => {
    const hours = hourStarts(DEFAULT_WORKING);
    const cells = buildHourCells(hours, DEFAULT_WORKING, [], { status: "HALF_DAY", presentFrom: 870, presentTo: 1140 }); // 14:30–19:00
    expect(cells.map((c) => c.kind)).toEqual(["off", "off", "off", "off", "lunch", "free", "free", "free", "free"]);
    const untimed = buildHourCells(hours, DEFAULT_WORKING, [], { status: "HALF_DAY" });
    expect(untimed.filter((c) => c.kind === "off")).toHaveLength(0);
  });
});
