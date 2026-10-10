import { describe, expect, it } from "vitest";
import {
  allowedAssignees,
  defaultTeamIds,
  emptyForm,
  fmtHours,
  fmtSecs,
  formatSlot,
  fromDatetimeLocal,
  HOUR_PRESETS,
  hoursToMinutes,
  repeatBaseDay,
  shortcutStart,
  stepHours,
  toDatetimeLocal,
  toTaskInput,
  validateForm,
} from "@/components/tasks/add-task-helpers";
import { taskInputSchema } from "@/server/tasks/schema";
import { defaultRule, repeatPresets } from "@/server/tasks/repeat-rule";
import type { DashboardData } from "@/server/tasks/types";

const TZ = "Asia/Kolkata";

const people: DashboardData["people"] = [
  { id: "admin", name: "Ada Admin", role: "ADMIN", teamId: null, teamLeaderId: null, specialityIds: [] },
  { id: "tl1", name: "Tina Lead", role: "TEAM_LEADER", teamId: "teamA", teamLeaderId: null, specialityIds: [] },
  { id: "tl2", name: "Tom Lead", role: "TEAM_LEADER", teamId: "teamB", teamLeaderId: null, specialityIds: [] },
  { id: "ex1", name: "Eve Exec", role: "EXECUTIVE", teamId: "teamA", teamLeaderId: "tl1", specialityIds: [] },
  { id: "ex2", name: "Eli Exec", role: "EXECUTIVE", teamId: "teamB", teamLeaderId: "tl2", specialityIds: [] },
];
const teams = [
  { id: "teamA", name: "A", colour: "#000" },
  { id: "teamB", name: "B", colour: "#000" },
];
const dataFor = (meId: string): Pick<DashboardData, "people" | "me" | "teams"> => {
  const me = people.find((p) => p.id === meId)!;
  return { people, teams, me: { id: me.id, role: me.role, teamId: me.teamId } };
};
const ids = (list: { id: string }[]) => list.map((p) => p.id);

describe("allowedAssignees (SPEC §2)", () => {
  it("Admin → Team Leaders + self (self first)", () => {
    expect(ids(allowedAssignees(dataFor("admin")))).toEqual(["admin", "tl1", "tl2"]);
  });
  it("Team Leader → own Executives + self", () => {
    expect(ids(allowedAssignees(dataFor("tl1")))).toEqual(["tl1", "ex1"]);
    expect(ids(allowedAssignees(dataFor("tl2")))).toEqual(["tl2", "ex2"]);
  });
  it("Executive → self only", () => {
    expect(ids(allowedAssignees(dataFor("ex1")))).toEqual(["ex1"]);
  });
  it("Meeting → anyone with a dashboard role, self first", () => {
    expect(ids(allowedAssignees(dataFor("ex1"), "MEETING"))).toEqual(["ex1", "admin", "tl1", "tl2", "ex2"]);
  });
  it("synthesises self when not present in people", () => {
    const data = { people: people.filter((p) => p.id !== "admin"), me: { id: "admin", role: "ADMIN", teamId: null } };
    expect(allowedAssignees(data)[0]).toMatchObject({ id: "admin", role: "ADMIN" });
  });
});

describe("defaultTeamIds", () => {
  it("collects the distinct teams of selected assignees", () => {
    expect(defaultTeamIds(dataFor("admin"), ["tl1", "ex1", "tl2"])).toEqual(["teamA", "teamB"]);
  });
  it("ignores unknown teams and people", () => {
    expect(defaultTeamIds({ ...dataFor("admin"), teams: [teams[0]!] }, ["tl2", "nobody"])).toEqual([]);
  });
});

describe("datetime helpers", () => {
  it("toDatetimeLocal renders the instant in the company tz", () => {
    expect(toDatetimeLocal(new Date("2026-09-12T04:30:00Z"), TZ)).toBe("2026-09-12T10:00");
    expect(toDatetimeLocal("2026-09-12T04:30:00Z", TZ)).toBe("2026-09-12T10:00");
    expect(toDatetimeLocal(null, TZ)).toBe("");
    expect(toDatetimeLocal("garbage", TZ)).toBe("");
  });
  it("fromDatetimeLocal returns ISO with the tz offset", () => {
    expect(fromDatetimeLocal("2026-09-12T10:00", TZ)).toBe("2026-09-12T10:00:00+05:30");
    expect(fromDatetimeLocal("", TZ)).toBeNull();
    expect(fromDatetimeLocal("nope", TZ)).toBeNull();
  });
  it("round-trips and is accepted by taskInputSchema", () => {
    const iso = fromDatetimeLocal("2026-09-12T14:30", TZ)!;
    expect(toDatetimeLocal(iso, TZ)).toBe("2026-09-12T14:30");
    expect(new Date(iso).toISOString()).toBe("2026-09-12T09:00:00.000Z");
    const parsed = taskInputSchema.safeParse({ title: "x", clientId: "c", assigneeIds: ["a"], scheduledStart: iso });
    expect(parsed.success).toBe(true);
  });
  it("shortcutStart: tomorrow 10:00 and today's next full hour", () => {
    const now = new Date("2026-09-12T04:20:00Z"); // 09:50 IST
    expect(shortcutStart("tomorrow", now, TZ)).toBe("2026-09-13T10:00");
    expect(shortcutStart("today", now, TZ)).toBe("2026-09-12T10:00");
    expect(shortcutStart("today", new Date("2026-09-12T17:45:00Z"), TZ)).toBe("2026-09-13T00:00"); // 23:15 IST → midnight
  });
  it("hoursToMinutes", () => {
    expect(hoursToMinutes("1.5")).toBe(90);
    expect(hoursToMinutes(0.5)).toBe(30);
    expect(hoursToMinutes("")).toBe(5);
    expect(hoursToMinutes("0.01")).toBe(5);
  });
  it("formatSlot", () => {
    const start = new Date("2026-09-10T04:30:00Z");
    expect(formatSlot({ start, end: new Date("2026-09-10T08:30:00Z") }, TZ)).toBe("Thu 10 Sep 10:00am – 2:00pm");
    expect(formatSlot({ start: start.toISOString(), end: "2026-09-11T08:30:00Z" }, TZ)).toBe("Thu 10 Sep 10:00am – Fri 11 Sep 2:00pm (spans 2 days)");
  });
});

describe("toTaskInput / validateForm", () => {
  it("builds a payload that taskInputSchema accepts (auto slot)", () => {
    const form = { ...emptyForm("WORK", "admin"), title: " Brief ", clientId: "c1", hours: 2.5, tagIds: ["w1"] };
    const payload = toTaskInput(form, TZ);
    expect(payload).toMatchObject({ title: "Brief", allocatedMinutes: 150, scheduledStart: null, scheduledEnd: null, recurrence: null, tagIds: ["w1"] });
    expect(taskInputSchema.safeParse(payload).success).toBe(true);
  });
  it("meetings drop tags but keep the repeat rule; the start comes from the calendar icon / shortcuts", () => {
    const form = {
      ...emptyForm("MEETING", "ex1"),
      title: "Sync",
      clientId: "c1",
      tagIds: ["w1"],
      recurrence: defaultRule("2026-09-12"),
      scheduledStart: "2026-09-12T10:00",
    };
    const payload = toTaskInput(form, TZ);
    expect(payload.tagIds).toEqual([]);
    expect(payload.recurrence).toMatchObject({ freq: defaultRule("2026-09-12").freq, trigger: "ON_SCHEDULE" });
    expect(payload.important).toBe(false); // no ★ Important for meetings
    expect(payload.scheduledStart).toBe("2026-09-12T10:00:00+05:30");
    expect(payload.scheduledEnd).toBeNull(); // the server ends it after the allocated time
    expect(taskInputSchema.safeParse(payload).success).toBe(true);
  });
  it("work tasks carry the repeat rule (ON_SCHEDULE) and the server schema accepts every preset", () => {
    const base = "2026-10-09";
    for (const p of repeatPresets(base)) {
      const recurrence = { ...defaultRule(base), ...p.patch, anchor: base };
      const payload = toTaskInput({ ...emptyForm("WORK", "ex1"), title: "t", clientId: "c", tagIds: ["w"], recurrence }, TZ);
      expect(payload.recurrence).toMatchObject({ freq: p.patch.freq, trigger: "ON_SCHEDULE" });
      const parsed = taskInputSchema.safeParse(payload);
      expect(parsed.success, p.label).toBe(true);
    }
    const until = { ...defaultRule(base), ends: "UNTIL" as const, until: "" };
    expect(taskInputSchema.safeParse(toTaskInput({ ...emptyForm("WORK", "ex1"), title: "t", clientId: "c", recurrence: until }, TZ)).success).toBe(false);
  });
  it("validateForm reports the mandatory fields", () => {
    const errors = validateForm({ ...emptyForm("WORK", "me"), assigneeIds: [], hours: 0 });
    expect(Object.keys(errors).sort()).toEqual(["assigneeIds", "clientId", "hours", "title"]);
    expect(validateForm({ ...emptyForm("WORK", "me"), title: "t", clientId: "c" })).toEqual({});
  });
});

describe("add-task body helpers (ADR 0010)", () => {
  it("hours: quick pills, ½h label and 15-minute stepper (min 15 minutes)", () => {
    expect(HOUR_PRESETS).toEqual([0.5, 1, 2, 3, 4, 6, 8]);
    expect(HOUR_PRESETS.map(fmtHours)).toEqual(["½h", "1h", "2h", "3h", "4h", "6h", "8h"]);
    expect(fmtHours(1.25)).toBe("1.25h");
    expect(fmtHours(1.5)).toBe("1.5h");
    expect(stepHours(2, 1)).toBe(2.25);
    expect(stepHours(0.25, -1)).toBe(0.25);
    expect(stepHours(0.5, -1)).toBe(0.25);
    expect(emptyForm("WORK", "me").hours).toBe(2);
    expect(fmtSecs(65)).toBe("1:05");
  });
  it("the repeat base day (company tz)", () => {
    expect(repeatBaseDay({ scheduledStart: "2026-12-01T10:00" })).toBe("2026-12-01");
    // 20:00 UTC on the 9th is already the 10th in Asia/Kolkata
    expect(repeatBaseDay({ scheduledStart: "" }, new Date("2026-10-09T20:00:00Z"), TZ)).toBe("2026-10-10");
  });
});

describe("tag-mode helpers", () => {
  it("teamLeaderId finds the leader of a team", async () => {
    const { teamLeaderId } = await import("@/components/tasks/add-task-helpers");
    expect(teamLeaderId({ people }, "teamA")).toBe("tl1");
    expect(teamLeaderId({ people }, "nope")).toBeNull();
  });
  it("parseAddParam", async () => {
    const { parseAddParam } = await import("@/components/tasks/add-task-helpers");
    expect(parseAddParam("WORK")).toBe("WORK");
    expect(parseAddParam("CHOOSE")).toBe("CHOOSE");
    expect(parseAddParam("nope")).toBeNull();
    expect(parseAddParam(null)).toBeNull();
  });
});
