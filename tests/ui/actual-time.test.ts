import { describe, expect, it } from "vitest";
import { actualTimeLines, relativeMinutes, type ActualTimeInput } from "@/components/dashboard/actual-time";

const TZ = "Asia/Kolkata";
// 11:00am – 3:00pm IST
const sched = { scheduledStart: "2026-09-15T05:30:00.000Z", scheduledEnd: "2026-09-15T09:30:00.000Z" };
const at = (iso: string) => new Date(iso);
const task = (p: Partial<ActualTimeInput>): ActualTimeInput => ({ status: "ASSIGNED", type: "WORK", ...sched, actualStart: null, actualEnd: null, finishRequestedAt: null, ...p });
const row = (t: ActualTimeInput, now: Date) => actualTimeLines(t, TZ, now).map((l) => [l.label, l.value, l.note, l.tone]);

describe("relativeMinutes", () => {
  it("formats late, early and on time", () => {
    expect(relativeMinutes(20)).toBe("20 min late");
    expect(relativeMinutes(-5)).toBe("5 min early");
    expect(relativeMinutes(0)).toBe("on time");
    expect(relativeMinutes(60)).toBe("1h late");
    expect(relativeMinutes(95)).toBe("1h 35m late");
    expect(relativeMinutes(-3090)).toBe("2d 3h early");
    expect(relativeMinutes(2880)).toBe("2d late");
  });
});

describe("actualTimeLines (time pill popover)", () => {
  it("not started, before the start: scheduled + not yet, no finish row", () => {
    expect(row(task({}), at("2026-09-15T05:00:00Z"))).toEqual([
      ["Scheduled", "11:00am – 3:00pm", null, null],
      ["Started", "not yet", null, null],
    ]);
  });

  it("not started after the start → red 'start time passed' (not for meetings)", () => {
    expect(row(task({}), at("2026-09-15T06:00:00Z"))[1]).toEqual(["Started", "not yet", "start time passed", "late"]);
    expect(row(task({ type: "MEETING" }), at("2026-09-15T06:00:00Z"))[1]).toEqual(["Started", "not yet", null, null]);
  });

  it("started late / early / on time (minute precision, in the company time zone)", () => {
    const now = at("2026-09-15T07:00:00Z");
    expect(row(task({ status: "STARTED", actualStart: "2026-09-15T05:50:00Z" }), now)[1]).toEqual(["Started", "11:20am", "20 min late", "late"]);
    expect(row(task({ status: "STARTED", actualStart: "2026-09-15T05:25:00Z" }), now)[1]).toEqual(["Started", "10:55am", "5 min early", "ok"]);
    expect(row(task({ status: "STARTED", actualStart: "2026-09-15T05:30:40Z" }), now)[1]).toEqual(["Started", "11:00am", "on time", "ok"]);
  });

  it("running: still running, red 'past end time' once the end has gone by", () => {
    const t = task({ status: "STARTED", actualStart: "2026-09-15T05:30:00Z" });
    expect(row(t, at("2026-09-15T09:00:00Z"))[2]).toEqual(["Finished", "still running", null, null]);
    expect(row(t, at("2026-09-15T09:30:30Z"))[2]).toEqual(["Finished", "still running", null, null]);
    expect(row(t, at("2026-09-15T09:31:00Z"))[2]).toEqual(["Finished", "still running", "past end time", "late"]);
    expect(row({ ...t, status: "PAUSED" }, at("2026-09-15T09:31:00Z"))[2]).toEqual(["Finished", "paused", "past end time", "late"]);
  });

  it("finished (completed): finish time + late / early against the scheduled end", () => {
    const now = at("2026-09-16T00:00:00Z");
    expect(row(task({ status: "COMPLETED", actualStart: "2026-09-15T05:50:00Z", actualEnd: "2026-09-15T09:15:00Z" }), now)).toEqual([
      ["Scheduled", "11:00am – 3:00pm", null, null],
      ["Started", "11:20am", "20 min late", "late"],
      ["Finished", "2:45pm", "15 min early", "ok"],
    ]);
    expect(row(task({ status: "COMPLETED", actualStart: "2026-09-15T05:30:00Z", actualEnd: "2026-09-15T09:40:00Z" }), now)[2]).toEqual(["Finished", "3:10pm", "10 min late", "late"]);
  });

  it("finish requested: 'Done (their side)' at the request time", () => {
    const t = task({ status: "FINISH_REQUESTED", actualStart: "2026-09-15T05:30:00Z", finishRequestedAt: "2026-09-15T09:30:00Z" });
    expect(row(t, at("2026-09-15T12:00:00Z"))[2]).toEqual(["Done (their side)", "3:00pm", "on time", "ok"]);
  });

  it("done without a recorded start: 'not recorded', no red note", () => {
    const t = task({ status: "FINISH_REQUESTED", finishRequestedAt: "2026-09-15T10:00:00Z" });
    expect(row(t, at("2026-09-15T12:00:00Z"))).toEqual([
      ["Scheduled", "11:00am – 3:00pm", null, null],
      ["Started", "not recorded", null, null],
      ["Done (their side)", "3:30pm", "30 min late", "late"],
    ]);
  });

  it("unscheduled: no comparison notes", () => {
    const t = task({ status: "STARTED", scheduledStart: null, scheduledEnd: null, actualStart: "2026-09-15T05:30:00Z" });
    expect(row(t, at("2026-09-15T12:00:00Z"))).toEqual([
      ["Scheduled", "--:-- – --:--", null, null],
      ["Started", "11:00am", null, null],
      ["Finished", "still running", null, null],
    ]);
  });
});
