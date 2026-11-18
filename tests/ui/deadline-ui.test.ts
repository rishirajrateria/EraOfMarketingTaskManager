import { describe, expect, it } from "vitest";
import { emptyForm, isDeadline, kindOf, toTaskInput, validateForm, type AddTaskForm } from "@/components/tasks/add-task-helpers";
import { deadlinePill, detailsCaption, whenCaption } from "@/components/tasks/details-caption";
import { actualTimeLines, type ActualTimeInput } from "@/components/dashboard/actual-time";
import { portalStatus } from "@/server/portal/portal";

const TZ = "Asia/Kolkata";
const NOW = new Date("2026-10-11T06:00:00Z"); // Sun 11 Oct 2026, 11:30 IST
const form = (p: Partial<AddTaskForm> = {}): AddTaskForm => ({ ...emptyForm("WORK", "me", "ADMIN"), ...p });
const data = {
  me: { id: "me", role: "ADMIN", teamId: null },
  people: [{ id: "tl", name: "Rishi", role: "TEAM_LEADER", teamId: "t1", teamLeaderId: null, specialityIds: [] }],
  workTypes: [{ id: "w1", name: "Design", colour: "#000", teamIds: ["t1"] }],
  teams: [{ id: "t1", name: "Social", colour: "#000" }],
  clients: [{ id: "c1", name: "Acme" }],
};

describe("add task: Deadline pill and For client", () => {
  it("the Deadline pill reads Deadline → Due 13 Oct; client tasks Needed by… → Needed by 13 Oct", () => {
    expect(deadlinePill(form())).toBe("Deadline");
    expect(deadlinePill(form({ deadline: true, scheduledStart: "2026-10-13" }))).toBe("Due 13 Oct");
    expect(deadlinePill(form({ forClient: true, deadline: true, scheduledStart: "" }))).toBe("Needed by…");
    expect(deadlinePill(form({ forClient: true, deadline: true, scheduledStart: "2026-10-13" }))).toBe("Needed by 13 Oct");
    // a day picked for Today / Tomorrow is not a deadline
    expect(deadlinePill(form({ scheduledStart: "2026-10-13" }))).toBe("Deadline");
  });

  it("captions: Due 13 Oct · no time blocked / Needed by 13 Oct, in the minimised tray too", () => {
    expect(whenCaption(form({ deadline: true, scheduledStart: "2026-10-13" }), NOW, TZ)).toBe("Due 13 Oct · no time blocked");
    expect(whenCaption(form({ deadline: true, scheduledStart: "" }), NOW, TZ)).toBe("Due — pick a date");
    expect(detailsCaption(form({ deadline: true, scheduledStart: "2026-10-13", teamIds: ["t1"], clientId: "c1" }), data, NOW, TZ)).toBe("Details · Social · Acme · Due 13 Oct · no time blocked");
    expect(detailsCaption(form({ forClient: true, deadline: true, scheduledStart: "2026-10-13", clientId: "c1" }), data, NOW, TZ)).toBe("Details · For client · Acme · Needed by 13 Oct");
  });

  it("kinds: Task / For client / Meeting; a meeting is never a deadline", () => {
    expect(kindOf(form())).toBe("WORK");
    expect(kindOf(form({ forClient: true }))).toBe("CLIENT");
    expect(kindOf({ type: "MEETING", forClient: true })).toBe("MEETING");
    expect(isDeadline(form({ forClient: true }))).toBe(true);
    expect(isDeadline({ type: "MEETING", deadline: true })).toBe(false);
  });

  it("payload: a deadline sends the day + deadlineOnly; a client task drops team, work type and people", () => {
    const dl = toTaskInput(form({ title: "Deck", deadline: true, scheduledStart: "2026-10-13", teamIds: ["t1"], tagIds: ["w1"], clientId: "c1" }), TZ);
    expect(dl).toMatchObject({ deadlineOnly: true, forClient: false, scheduledStart: "2026-10-13", teamIds: ["t1"], tagIds: ["w1"] });
    const fc = toTaskInput(form({ title: "Photos", forClient: true, deadline: true, scheduledStart: "2026-10-13", teamIds: ["t1"], tagIds: ["w1"], assigneeIds: ["tl"], clientId: "c1" }), TZ);
    expect(fc).toMatchObject({ deadlineOnly: true, forClient: true, scheduledStart: "2026-10-13", teamIds: [], tagIds: [], assigneeIds: [], preferredAssigneeIds: [] });
    expect(toTaskInput(form({ title: "x" }), TZ)).toMatchObject({ deadlineOnly: false, forClient: false, scheduledStart: null });
  });

  it("validation: a client task needs only a title, client and Needed by day; a deadline needs its day, not hours", () => {
    expect(validateForm(form({ forClient: true, deadline: true, title: "Photos" }), data)).toEqual({ clientId: "Pick a client in the rows below", when: "Pick the date it is needed by" });
    expect(validateForm(form({ forClient: true, deadline: true, title: "Photos", clientId: "c1", scheduledStart: "2026-10-13" }), data)).toEqual({});
    const dl = validateForm(form({ deadline: true, title: "Deck", clientId: "c1", teamIds: ["t1"], tagIds: ["w1"], hours: 0 }), data);
    expect(dl).toEqual({ when: "Pick the due date" });
  });
});

describe("card: deadline time popover and the portal status words", () => {
  const due = "2026-10-13T13:30:00.000Z"; // 13 Oct 19:00 IST
  const t = (p: Partial<ActualTimeInput> = {}): ActualTimeInput => ({ status: "ASSIGNED", type: "WORK", scheduledStart: due, scheduledEnd: due, actualStart: null, actualEnd: null, deadlineOnly: true, ...p });

  it("reads Deadline 13 Oct · by end of day; red notes once the day has passed", () => {
    expect(actualTimeLines(t(), TZ, NOW).map((l) => [l.label, l.value, l.note])).toEqual([
      ["Deadline", "13 Oct · by end of day", null],
      ["Started", "not yet", null],
    ]);
    const late = new Date("2026-10-14T06:00:00Z");
    expect(actualTimeLines(t(), TZ, late)[1]).toMatchObject({ note: "deadline passed", tone: "late" });
    expect(actualTimeLines(t({ status: "STARTED", actualStart: "2026-10-12T05:00:00Z" }), TZ, late).map((l) => l.note)).toEqual([null, null, "past the deadline"]);
  });

  it("portal status words follow the row colours", () => {
    const base = { status: "ASSIGNED" as const, doubtRaised: false, type: "WORK" as const, scheduledStart: new Date(due), forClient: false };
    expect(portalStatus(base, NOW)).toEqual({ status: "Not started", tone: "white" });
    expect(portalStatus(base, new Date("2026-10-14T00:00:00Z"))).toEqual({ status: "Not started · overdue", tone: "red" });
    expect(portalStatus({ ...base, forClient: true }, new Date("2026-10-14T00:00:00Z"))).toEqual({ status: "Waiting for you · overdue", tone: "red" });
    expect(portalStatus({ ...base, status: "STARTED" }, NOW)).toEqual({ status: "In progress", tone: "green" });
    expect(portalStatus({ ...base, status: "PAUSED" }, NOW)).toEqual({ status: "On hold", tone: "yellow" });
    expect(portalStatus({ ...base, doubtRaised: true }, NOW)).toEqual({ status: "Query raised", tone: "purple" });
    expect(portalStatus({ ...base, status: "COMPLETED" }, NOW)).toEqual({ status: "Done", tone: "grey" });
  });
});
