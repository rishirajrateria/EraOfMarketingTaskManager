import { describe, it, expect } from "vitest";
import { TRAY_NAME, trayStorageKey } from "@/components/dashboard/tray-key";
import { detailsCaption, whenCaption } from "@/components/tasks/details-caption";
import { emptyForm, type AddTaskForm } from "@/components/tasks/add-task-helpers";

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
