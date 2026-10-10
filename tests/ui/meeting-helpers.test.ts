import { describe, expect, it } from "vitest";
import { emptyForm, toTaskInput, validateForm, externalGuests, meetingInvitees } from "@/components/tasks/add-task-helpers";
import {
  START_SLOTS,
  fmtDuration,
  fmtStartPill,
  guestCount,
  isShortcutDay,
  meetingShortcut,
  pickClient,
  pickStartTime,
  voiceNotesFor,
} from "@/components/tasks/meeting-helpers";
import { taskInputSchema } from "@/server/tasks/schema";
import type { DashboardData } from "@/server/tasks/types";

const TZ = "Asia/Kolkata";
// Mon 12 Oct 2026 14:10 IST
const NOW = new Date("2026-10-12T08:40:00Z");
const people: DashboardData["people"] = [
  { id: "admin", name: "Rishi Rateria", role: "ADMIN", teamId: null, teamLeaderId: null, specialityIds: [] },
  { id: "priya", name: "Priya Sharma", role: "TEAM_LEADER", teamId: "social", teamLeaderId: null, specialityIds: [] },
  { id: "arjun", name: "Arjun Kumar", role: "EXECUTIVE", teamId: "social", teamLeaderId: "priya", specialityIds: [] },
  { id: "sana", name: "Sana Ali", role: "EXECUTIVE", teamId: "graphic", teamLeaderId: null, specialityIds: [] },
];
const data = {
  people,
  workTypes: [],
  me: { id: "admin", role: "ADMIN", teamId: null },
  clients: [
    { id: "repo", name: "Repo", emails: ["billing@repo.example"] },
    { id: "bare", name: "Bare", emails: [] },
  ],
};
const meeting = (p: Partial<ReturnType<typeof emptyForm>> = {}) => ({ ...emptyForm("MEETING", "admin", "ADMIN"), title: "Kickoff", clientId: "repo", ...p });

describe("meeting duration and start pills", () => {
  it("defaults: meetings 30 minutes, tasks keep 2h", () => {
    expect(emptyForm("MEETING", "admin").hours).toBe(0.5);
    expect(emptyForm("WORK", "admin").hours).toBe(2);
  });
  it("fmtDuration", () => {
    expect([0.25, 0.5, 0.75, 1, 1.5, 2].map(fmtDuration)).toEqual(["15m", "30m", "45m", "1h", "1½h", "2h"]);
    expect(fmtDuration(1.25)).toBe("1h 15m");
    expect(fmtDuration(2.5)).toBe("2½h");
  });
  it("START pills: every 30 minutes 9 am … 8 pm", () => {
    expect(START_SLOTS).toHaveLength(23);
    expect(START_SLOTS.map(fmtStartPill).slice(0, 3)).toEqual(["9 am", "9:30 am", "10 am"]);
    expect(fmtStartPill(12 * 60)).toBe("12 pm");
    expect(fmtStartPill(12 * 60 + 30)).toBe("12:30 pm");
    expect(fmtStartPill(START_SLOTS.at(-1)!)).toBe("8 pm");
  });
});

describe("picking the start", () => {
  it("no day yet: today when the time is still ahead (IST), else tomorrow", () => {
    expect(pickStartTime("", 16 * 60, NOW, TZ)).toBe("2026-10-12T16:00");
    expect(pickStartTime("", 14 * 60, NOW, TZ)).toBe("2026-10-13T14:00");
    expect(pickStartTime("", 14 * 60 + 10, NOW, TZ)).toBe("2026-10-13T14:10"); // not strictly ahead
    // just after midnight IST (still 12 Oct in UTC): "today" is the Kolkata day, 13 Oct
    const lateUtc = new Date("2026-10-12T19:00:00Z"); // 13 Oct 00:30 IST
    expect(pickStartTime("", 9 * 60, lateUtc, TZ)).toBe("2026-10-13T09:00");
  });
  it("keeps the day chosen with Tom / today / the calendar icon", () => {
    expect(pickStartTime("2026-10-20T10:00", 15 * 60 + 30, NOW, TZ)).toBe("2026-10-20T15:30");
  });
  it("Tom / today change only the day once a time is picked; else they act as for tasks", () => {
    expect(meetingShortcut("tomorrow", "2026-10-12T16:00", NOW, TZ)).toBe("2026-10-13T16:00");
    expect(meetingShortcut("today", "2026-10-20T09:30", NOW, TZ)).toBe("2026-10-12T09:30");
    expect(meetingShortcut("tomorrow", "", NOW, TZ)).toBe("2026-10-13T10:00");
    expect(isShortcutDay("tomorrow", "2026-10-13T16:00", NOW, TZ)).toBe(true);
    expect(isShortcutDay("today", "2026-10-13T16:00", NOW, TZ)).toBe(false);
    expect(isShortcutDay("today", "", NOW, TZ)).toBe(false);
  });
});

describe("meeting guests", () => {
  it("picking a client adds its emails; deselecting / switching removes them; tasks never get them", () => {
    const f = meeting({ clientId: "" });
    expect(pickClient(f, data, "repo")).toEqual({ clientId: "repo", clientGuests: ["billing@repo.example"], inviteClient: false });
    expect(pickClient({ ...f, clientId: "repo" }, data, "repo")).toEqual({ clientId: "", clientGuests: [], inviteClient: false });
    expect(pickClient({ ...f, clientId: "repo" }, data, "bare")).toEqual({ clientId: "bare", clientGuests: [], inviteClient: false });
    expect(pickClient({ ...emptyForm("WORK", "admin"), clientId: "" }, data, "repo")).toEqual({ clientId: "repo", clientGuests: [], inviteClient: false });
  });
  it("Team Leader / Executive data has no client emails: picking the client asks the server to invite it (ADR 0017)", () => {
    const tlData = { ...data, me: { id: "priya", role: "TEAM_LEADER", teamId: "social" }, clients: [{ id: "repo", name: "Repo", guestCount: 2 }, { id: "bare", name: "Bare", guestCount: 0 }] };
    const f = { ...emptyForm("MEETING", "priya", "TEAM_LEADER"), title: "Kickoff", clientId: "" };
    const picked = pickClient(f, tlData, "repo");
    expect(picked).toEqual({ clientId: "repo", clientGuests: [], inviteClient: true });
    expect(pickClient(f, tlData, "bare").inviteClient).toBe(false);
    const form = { ...f, ...picked };
    expect(guestCount(form, tlData)).toBe(2);
    expect(validateForm(form, tlData)).toEqual({});
    const p = toTaskInput(form, TZ);
    expect(p).toMatchObject({ inviteClient: true, guestEmails: [] });
    expect(taskInputSchema.safeParse(p).success).toBe(true);
    expect(toTaskInput({ ...form, type: "WORK" }, TZ).inviteClient).toBe(false);
  });
  it("invitees = me + the teams' Team Leaders (executives only when picked) + picked people; count excludes me", () => {
    const f = meeting({ teamIds: ["social"], assigneeIds: ["sana", "priya"], clientGuests: ["billing@repo.example"], guestEmails: ["Billing@repo.example", "x@y.co"] });
    expect(meetingInvitees(f, data)).toEqual(["admin", "priya", "sana"]);
    expect(meetingInvitees({ teamIds: ["graphic"], assigneeIds: [] }, data)).toEqual(["admin"]); // no Team Leader in Graphic
    expect(externalGuests(f)).toEqual(["billing@repo.example", "x@y.co"]);
    expect(guestCount(f, data)).toBe(4);
  });
  it("validateForm: no team needed, but someone besides the organiser", () => {
    expect(validateForm(meeting(), data)).toEqual({ assigneeIds: "Invite someone: pick a team, people or add a guest email" });
    expect(validateForm(meeting({ clientGuests: ["billing@repo.example"] }), data)).toEqual({});
    expect(validateForm(meeting({ teamIds: ["social"] }), data)).toEqual({});
    expect(validateForm(meeting({ clientId: "", assigneeIds: ["sana"] }), data)).toEqual({ clientId: "Pick a client in the rows below" });
  });
  it("voice notes are never uploaded for meetings", () => {
    expect(voiceNotesFor("MEETING", [1, 2])).toEqual([]);
    expect(voiceNotesFor("WORK", [1, 2])).toEqual([1, 2]);
  });
});

describe("meeting payload and summary line", () => {
  it("toTaskInput sends guests, options and the start in the meeting's zone", () => {
    const f = meeting({ scheduledStart: "2026-10-13T16:00", clientGuests: ["billing@repo.example"], guestEmails: ["X@Y.co"], hours: 0.75 });
    const p = toTaskInput(f, TZ);
    expect(p).toMatchObject({ type: "MEETING", allocatedMinutes: 45, scheduledStart: "2026-10-13T16:00:00+05:30", guestEmails: ["billing@repo.example", "x@y.co"], tagIds: [] });
    expect(p.meetingOptions).toMatchObject({ timeZone: TZ, withMeet: true });
    expect(taskInputSchema.safeParse(p).success).toBe(true);
    const london = toTaskInput({ ...f, meeting: { ...f.meeting, timeZone: "Europe/London" } }, TZ);
    expect(london.scheduledStart).toBe("2026-10-13T16:00:00+01:00");
    const allDay = toTaskInput({ ...f, meeting: { ...f.meeting, allDay: true } }, TZ);
    expect(allDay.scheduledStart).toBe("2026-10-13T00:00:00+05:30");
  });
  it("work tasks send no guests or options", () => {
    const p = toTaskInput({ ...emptyForm("WORK", "admin"), title: "t", clientId: "c", tagIds: ["w"], guestEmails: ["a@b.co"] }, TZ);
    expect(p.guestEmails).toEqual([]);
    expect(p.meetingOptions).toBeNull();
  });
});
