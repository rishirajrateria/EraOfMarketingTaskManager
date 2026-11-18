/** ADR 0022 — going home early in `personDayStatus` and the "Needs shifting" rule (pure, no DB). */
import { describe, expect, it } from "vitest";
import { parseDateKey, zonedDayAt } from "@/lib/time";
import { personDayStatus } from "@/server/availability/day-status";
import { awayLabel, coverPeriod, hitsPeriod, periodDetail, roundToQuarter } from "@/server/early-leave/core";

const TZ = "Asia/Kolkata";
const TUE = "2026-11-10";
const WED = "2026-11-11";
const THU = "2026-11-12";
const at = (key: string, hhmm: string) => zonedDayAt(parseDateKey(key, TZ), Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
const cfg = { timezone: TZ, workStartMinutes: 600, workEndMinutes: 1140, lunchStartMinutes: 810, lunchEndMinutes: 870, workingDays: [1, 2, 3, 4, 5, 6], holidays: [] as string[], halfDayMinutes: 240 };
const user = { dailyCapacityMinutes: null, workingDays: [] as number[] };

describe("going home early — pure rules (ADR 0022)", () => {
  it("personDayStatus: AWAY days, the leaving day's window and capacity, precedence", () => {
    const d = (extra: Partial<Parameters<typeof personDayStatus>[0]>) => personDayStatus({ user, dayKey: TUE, cfg, onLeave: false, ...extra });
    expect(d({ away: { leftAt: null, reason: "SICK" } })).toMatchObject({ kind: "AWAY", capacityMinutes: 0, window: [] });
    expect(d({ onLeave: true, away: { leftAt: null, reason: "SICK" } }).kind).toBe("LEAVE"); // approved leave still wins
    expect(d({ attendance: { status: "ABSENT" }, away: { leftAt: null, reason: "SICK" } }).kind).toBe("ABSENT");
    expect(d({ away: { leftAt: at(TUE, "12:00"), reason: "SICK" } })).toMatchObject({ kind: "WORKING", capacityMinutes: 120 });
    expect(d({ away: { leftAt: at(TUE, "09:00"), reason: "SICK" } })).toMatchObject({ kind: "WORKING", capacityMinutes: 0, window: [] });
    expect(d({ attendance: { status: "HALF_DAY" }, away: { leftAt: at(TUE, "11:00"), reason: "SICK" } })).toMatchObject({ kind: "HALF", capacityMinutes: 60 });
    // a capacity override is kept when there is still that much time before leaving
    expect(personDayStatus({ user: { dailyCapacityMinutes: 120, workingDays: [] }, dayKey: TUE, cfg, onLeave: false, away: { leftAt: at(TUE, "15:00"), reason: "SICK" } }).capacityMinutes).toBe(120);
    expect(d({}).away).toBeNull();
  });

  it("hitsPeriod: open, scheduled tasks overlapping [leftAt, end of the last covered day)", () => {
    const p = coverPeriod({ leftAt: at(TUE, "15:00"), coveredThrough: WED }, TZ);
    const t = (from: Date | null, to: Date | null, status = "ASSIGNED") => hitsPeriod({ status, scheduledStart: from, scheduledEnd: to }, p);
    expect(t(at(TUE, "14:00"), at(TUE, "15:00"))).toBe(false);
    expect(t(at(TUE, "14:30"), at(TUE, "15:30"))).toBe(true);
    expect(t(at(WED, "18:00"), at(WED, "19:00"))).toBe(true);
    expect(t(at(THU, "10:00"), at(THU, "11:00"))).toBe(false);
    expect(t(at(WED, "19:00"), at(WED, "19:00"))).toBe(true); // a deadline inside
    expect(t(at(TUE, "14:00"), at(TUE, "14:00"))).toBe(false); // a deadline before leftAt
    expect(t(null, null)).toBe(false);
    expect(t(at(TUE, "16:00"), at(TUE, "17:00"), "COMPLETED")).toBe(false);
    expect(t(at(TUE, "16:00"), at(TUE, "17:00"), "DRAFT")).toBe(false);
  });

  it("labels and the quarter-hour default", () => {
    const rec = { day: TUE, leftAt: at(TUE, "14:15"), reason: "SICK" as const, mode: "ASK" as const, until: null, backOn: null };
    expect(awayLabel(rec, TUE, TZ)).toBe("Left early 2:15pm · Sick");
    expect(awayLabel(rec, WED, TZ)).toBe("Away · Sick");
    expect(periodDetail(rec, TZ)).toBe("2:15pm · Sick · asking again tomorrow morning");
    expect(periodDetail({ ...rec, mode: "UNTIL", until: WED }, TZ)).toBe("2:15pm · Sick · away until 11 Nov");
    expect(roundToQuarter(at(TUE, "14:08")).getTime()).toBe(at(TUE, "14:15").getTime());
    expect(roundToQuarter(at(TUE, "14:07")).getTime()).toBe(at(TUE, "14:00").getTime());
  });
});
