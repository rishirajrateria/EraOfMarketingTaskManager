import { describe, it, expect } from "vitest";
import { TRAY_NAME, trayStorageKey } from "@/components/dashboard/tray-key";
import { dayFallbackToast, detailsCaption, whenCaption, type SlotPreview } from "@/components/tasks/details-caption";
import { emptyForm, shortcutStart, type AddTaskForm } from "@/components/tasks/add-task-helpers";

/**
 * The add-task screen's details tray (ADR 0016 addendum, prototype `#addTray` / `addTrayTog`): it minimises like the
 * dashboard's filter tray, remembered under its own key, and the minimised bar sums the rows up in one line.
 */
const TZ = "Asia/Kolkata";
// Sat 10 Oct 2026, 15:30 in Kolkata
const NOW = new Date("2026-10-10T10:00:00Z");
const data = {
  teams: [
    { id: "t1", name: "Social", colour: "#000" },
    { id: "t2", name: "Video", colour: "#000" },
  ],
  clients: [{ id: "c1", name: "Acme" }],
};
const form = (p: Partial<AddTaskForm> = {}, type: AddTaskForm["type"] = "WORK"): AddTaskForm => ({ ...emptyForm(type, "me", "ADMIN"), ...p });

describe("tray memory", () => {
  it("keeps the task dashboard's key and gives the add-task and Admin dashboards trays their own, all per user", () => {
    expect(trayStorageKey("filters", "u1")).toBe("eom:dash-tray-min:u1");
    expect(trayStorageKey("details", "u1")).toBe("eom:add-tray-min:u1");
    expect(trayStorageKey("dashboards", "u1")).toBe("eom:dashboards-tray-min:u1");
    expect(new Set((["filters", "details", "dashboards"] as const).map((k) => trayStorageKey(k, "u1"))).size).toBe(3);
    expect(trayStorageKey("details", "u2")).not.toBe(trayStorageKey("details", "u1"));
  });

  it("names the tab after its tray", () => {
    expect(TRAY_NAME.filters).toEqual({ region: "Filters", show: "Show filters", hide: "Hide filters" });
    expect(TRAY_NAME.details).toEqual({ region: "Details", show: "Show details", hide: "Hide details" });
    expect(TRAY_NAME.dashboards).toEqual({ region: "Dashboard filters", show: "Show filters", hide: "Hide filters" });
  });
});

describe("minimised details caption", () => {
  it("is just Details · Up next on a fresh form", () => {
    expect(detailsCaption(form(), data, NOW, TZ)).toBe("Details · Up next");
  });

  it("lists the picked teams, the client and the start", () => {
    expect(detailsCaption(form({ teamIds: ["t1"], clientId: "c1" }), data, NOW, TZ)).toBe("Details · Social · Acme · Up next");
    expect(detailsCaption(form({ teamIds: ["t2", "t1"], clientId: "c1", scheduledStart: "2026-10-11T10:00" }), data, NOW, TZ)).toBe("Details · Video + Social · Acme · Tomorrow 10 am");
    expect(detailsCaption(form({ clientId: "c1", scheduledStart: "2026-10-10T16:00" }), data, NOW, TZ)).toBe("Details · Acme · Today 4 pm");
  });

  it("skips teams and clients it does not know", () => {
    expect(detailsCaption(form({ teamIds: ["gone"], clientId: "gone" }), data, NOW, TZ)).toBe("Details · Up next");
  });

  it("names other days, with the time as on the START pills", () => {
    expect(whenCaption(form({ scheduledStart: "2026-10-13T09:30" }), NOW, TZ)).toBe("Tue 13 Oct 9:30 am");
    expect(whenCaption(form({ scheduledStart: "2026-12-01T12:00" }), NOW, TZ)).toBe("Tue 1 Dec 12 pm");
  });

  it("reads today / tomorrow in the zone the start is picked in", () => {
    // 10 Oct 23:30 UTC is already 11 Oct in Kolkata
    const late = new Date("2026-10-10T23:30:00Z");
    expect(whenCaption(form({ scheduledStart: "2026-10-11T10:00" }), late, TZ)).toBe("Today 10 am");
    expect(whenCaption(form({ scheduledStart: "2026-10-11T10:00" }), late, "UTC")).toBe("Tomorrow 10 am");
  });

  it("shows only the day of an all-day meeting", () => {
    const m = form({ scheduledStart: "2026-10-11T00:00" }, "MEETING");
    expect(whenCaption({ ...m, meeting: { ...m.meeting, allDay: true } }, NOW, TZ)).toBe("Tomorrow");
    expect(whenCaption(m, NOW, TZ)).toBe("Tomorrow 12 am");
  });
});

describe("date-only start: next free time on that day (ADR 0010 addendum)", () => {
  // the server's preview: 11:30 IST on Fri 23 Oct
  const onDay: SlotPreview = { start: "2026-10-23T06:00:00.000Z", end: "2026-10-23T08:00:00.000Z", day: { requestedDay: "2026-10-23", onRequestedDay: true, missed: null, freeMinutes: 480 } };

  it("reads '<day> - next free' until the preview is in, then adds the resolved time", () => {
    expect(whenCaption(form({ scheduledStart: "2026-10-23" }), NOW, TZ)).toBe("Fri 23 Oct - next free");
    expect(whenCaption(form({ scheduledStart: "2026-10-23" }), NOW, TZ, null)).toBe("Fri 23 Oct - next free");
    expect(whenCaption(form({ scheduledStart: "2026-10-23" }), NOW, TZ, onDay)).toBe("Fri 23 Oct - next free 11:30 am");
    expect(whenCaption(form({ scheduledStart: "2026-10-23" }), NOW, TZ, { ...onDay, start: new Date(onDay.start) })).toBe("Fri 23 Oct - next free 11:30 am");
    expect(detailsCaption(form({ teamIds: ["t1"], clientId: "c1", scheduledStart: "2026-10-23" }), data, NOW, TZ, onDay)).toBe("Details · Social · Acme · Fri 23 Oct - next free 11:30 am");
  });

  it("Today / Tomorrow shortcuts are date-only and read as such", () => {
    expect(whenCaption(form({ scheduledStart: shortcutStart("today", NOW, TZ) }), NOW, TZ)).toBe("Today - next free");
    const tomorrow: SlotPreview = { start: "2026-10-11T04:30:00.000Z", end: "2026-10-11T05:30:00.000Z", day: { requestedDay: "2026-10-11", onRequestedDay: true, missed: null, freeMinutes: 480 } };
    expect(whenCaption(form({ scheduledStart: shortcutStart("tomorrow", NOW, TZ) }), NOW, TZ, tomorrow)).toBe("Tomorrow - next free 10 am");
  });

  it("ignores a preview for another day or another shape of start", () => {
    expect(whenCaption(form({ scheduledStart: "2026-10-24" }), NOW, TZ, onDay)).toBe("Sat 24 Oct - next free");
    expect(whenCaption(form({ scheduledStart: "2026-10-23T14:00" }), NOW, TZ, onDay)).toBe("Fri 23 Oct 2 pm");
    expect(whenCaption(form({ scheduledStart: "" }), NOW, TZ, onDay)).toBe("Up next");
  });

  it("says when the day was full (or off) and where the task went instead", () => {
    const full: SlotPreview = { start: "2026-10-24T04:30:00.000Z", end: "2026-10-24T05:30:00.000Z", day: { requestedDay: "2026-10-23", onRequestedDay: false, missed: "full", freeMinutes: 0 } };
    expect(whenCaption(form({ scheduledStart: "2026-10-23" }), NOW, TZ, full)).toBe("Fri 23 Oct full - next free Sat 24 Oct 10 am");
    const off: SlotPreview = { start: "2026-10-26T04:30:00.000Z", end: "2026-10-26T05:30:00.000Z", day: { requestedDay: "2026-10-25", onRequestedDay: false, missed: "day-off", freeMinutes: 0 } };
    expect(whenCaption(form({ scheduledStart: "2026-10-25" }), NOW, TZ, off)).toBe("Sun 25 Oct is a day off - next free Mon 26 Oct 10 am");
    // too little room / today over: it says how much was free, or that the day is over
    const short: SlotPreview = { ...full, day: { requestedDay: "2026-10-23", onRequestedDay: false, missed: "no-room", freeMinutes: 60 } };
    expect(whenCaption(form({ scheduledStart: "2026-10-23" }), NOW, TZ, short)).toBe("Fri 23 Oct has only 1h free - next free Sat 24 Oct 10 am");
    const over: SlotPreview = { start: "2026-10-12T04:30:00.000Z", end: "2026-10-12T05:30:00.000Z", day: { requestedDay: "2026-10-10", onRequestedDay: false, missed: "over", freeMinutes: 0 } };
    expect(whenCaption(form({ scheduledStart: "2026-10-10" }), NOW, TZ, over)).toBe("Today is over - next free Mon 12 Oct 10 am");
    // the all-day meeting shows the day only, whatever the preview says
    const m = form({ scheduledStart: "2026-10-23" }, "MEETING");
    expect(whenCaption({ ...m, meeting: { ...m.meeting, allDay: true } }, NOW, TZ, full)).toBe("Fri 23 Oct");
  });

  it("a task that starts on the day and runs on into the next is still 'on that day' (no fallback wording)", () => {
    const spans: SlotPreview = { start: "2026-10-23T04:30:00.000Z", end: "2026-10-24T05:00:00.000Z", day: { requestedDay: "2026-10-23", onRequestedDay: true, missed: null, freeMinutes: 480 } };
    expect(whenCaption(form({ scheduledStart: "2026-10-23" }), NOW, TZ, spans)).toBe("Fri 23 Oct - next free 10 am");
    expect(dayFallbackToast({ slot: spans, day: spans.day }, TZ)).toBeNull();
  });

  it("shows why the server refused the day instead of a dangling 'next free'", () => {
    const refused: SlotPreview = { day: { requestedDay: "2026-10-09" }, error: "That day has passed — pick today or later" };
    expect(whenCaption(form({ scheduledStart: "2026-10-09" }), NOW, TZ, refused)).toBe("Fri 9 Oct - That day has passed — pick today or later");
    expect(detailsCaption(form({ clientId: "c1", scheduledStart: "2026-10-09" }), data, NOW, TZ, refused)).toBe("Details · Acme · Fri 9 Oct - That day has passed — pick today or later");
    // an error about another day does not apply
    expect(whenCaption(form({ scheduledStart: "2026-10-23" }), NOW, TZ, refused)).toBe("Fri 23 Oct - next free");
  });

  it("dayFallbackToast: only when the start was a day that did not fit", () => {
    const slot = { start: "2026-10-24T04:30:00.000Z", end: "2026-10-24T05:30:00.000Z" };
    expect(dayFallbackToast({ slot, day: { requestedDay: "2026-10-23", onRequestedDay: false, missed: "full", freeMinutes: 0 } }, TZ)).toBe("Fri 23 Oct was full - scheduled for Sat 24 Oct 10 am");
    expect(dayFallbackToast({ slot: { ...slot, start: "2026-10-26T09:00:00.000Z" }, day: { requestedDay: "2026-10-25", onRequestedDay: false, missed: "day-off", freeMinutes: 0 } }, TZ)).toBe("Sun 25 Oct is a day off - scheduled for Mon 26 Oct 2:30 pm");
    expect(dayFallbackToast({ slot, day: { requestedDay: "2026-10-23", onRequestedDay: false, missed: "no-room", freeMinutes: 90 } }, TZ)).toBe("Fri 23 Oct had only 1½h free - scheduled for Sat 24 Oct 10 am");
    expect(dayFallbackToast({ slot, day: { requestedDay: "2026-10-23", onRequestedDay: false, missed: "over", freeMinutes: 0 } }, TZ)).toBe("Fri 23 Oct is over - scheduled for Sat 24 Oct 10 am");
    expect(dayFallbackToast({ slot, day: { requestedDay: "2026-10-24", onRequestedDay: true, missed: null, freeMinutes: 480 } }, TZ)).toBeNull();
    expect(dayFallbackToast({ slot }, TZ)).toBeNull(); // explicit / up-next starts carry no day
    expect(dayFallbackToast({ slot: null }, TZ)).toBeNull();
  });
});
