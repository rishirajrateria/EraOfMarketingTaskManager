import { describe, expect, it } from "vitest";
import {
  allowedAssignees,
  defaultTeamIds,
  emptyForm,
  formatSlot,
  fromDatetimeLocal,
  hoursToMinutes,
  shortcutStart,
  toDatetimeLocal,
  toTaskInput,
  validateForm,
} from "@/components/tasks/add-task-helpers";
import { taskInputSchema } from "@/server/tasks/schema";
import type { DashboardData } from "@/server/tasks/types";

const TZ = "Asia/Kolkata";

const people: DashboardData["people"] = [
  { id: "admin", name: "Ada Admin", role: "ADMIN", teamId: null, teamLeaderId: null },
  { id: "tl1", name: "Tina Lead", role: "TEAM_LEADER", teamId: "teamA", teamLeaderId: null },
  { id: "tl2", name: "Tom Lead", role: "TEAM_LEADER", teamId: "teamB", teamLeaderId: null },
  { id: "ex1", name: "Eve Exec", role: "EXECUTIVE", teamId: "teamA", teamLeaderId: "tl1" },
  { id: "ex2", name: "Eli Exec", role: "EXECUTIVE", teamId: "teamB", teamLeaderId: "tl2" },
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
    const form = { ...emptyForm("WORK", "admin"), title: " Brief ", clientId: "c1", allocatedHours: "2.5", tagIds: ["w1"] };
    const payload = toTaskInput(form, TZ);
    expect(payload).toMatchObject({ title: "Brief", allocatedMinutes: 150, scheduledStart: null, scheduledEnd: null, acceptProposedSlot: false, tagIds: ["w1"] });
    expect(taskInputSchema.safeParse(payload).success).toBe(true);
    expect(toTaskInput({ ...form, acceptProposedSlot: true }, TZ).acceptProposedSlot).toBe(true);
  });
  it("meetings drop tags and recurrence; manual time disables acceptProposedSlot", () => {
    const form = {
      ...emptyForm("MEETING", "ex1"),
      title: "Sync",
      clientId: "c1",
      tagIds: ["w1"],
      recurrence: { frequency: "DAILY" as const, interval: 1, byWeekday: [], trigger: "ON_SCHEDULE" as const, endDate: null },
      scheduledStart: "2026-09-12T10:00",
      scheduledEnd: "2026-09-12T09:00",
    };
    const payload = toTaskInput(form, TZ);
    expect(payload.tagIds).toEqual([]);
    expect(payload.recurrence).toBeNull();
    expect(payload.acceptProposedSlot).toBe(false);
    expect(payload.scheduledStart).toBe("2026-09-12T10:00:00+05:30");
    expect(payload.scheduledEnd).toBeNull(); // end before start is dropped → server derives from allocated time
    expect(taskInputSchema.safeParse(payload).success).toBe(true);
  });
  it("validateForm reports the mandatory fields", () => {
    const errors = validateForm({ ...emptyForm("WORK", "me"), assigneeIds: [], allocatedHours: "0" });
    expect(Object.keys(errors).sort()).toEqual(["allocatedHours", "assigneeIds", "clientId", "title"]);
    expect(validateForm({ ...emptyForm("WORK", "me"), title: "t", clientId: "c" })).toEqual({});
  });
});
