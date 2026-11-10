import { describe, expect, it } from "vitest";
import {
  addReminder,
  clientGuestEmails,
  defaultMeetingOptions,
  describeReminder,
  findTimeWindow,
  meetingAttendees,
  mergeBusy,
  readMeetingOptions,
  reminderMinutes,
  splitEmails,
  splitReminder,
  suggestSlots,
  timeZoneChoices,
} from "@/server/tasks/meeting";
import { guestEmailsSchema, meetingOptionsSchema, taskInputSchema } from "@/server/tasks/schema";

const T = (hhmm: string) => Date.parse(`2026-10-12T${hhmm}:00Z`);
const span = (a: string, b: string) => ({ start: T(a), end: T(b) });
const W = span("08:00", "21:00");
const fmt = (list: { start: number; end: number }[]) => list.map((s) => `${new Date(s.start).toISOString().slice(11, 16)}-${new Date(s.end).toISOString().slice(11, 16)}`);

describe("meeting options schema", () => {
  it("defaults like Google Calendar and accepts a partial payload", () => {
    expect(defaultMeetingOptions()).toEqual({
      reminders: [{ method: "popup", minutes: 10 }],
      guestsCanModify: false,
      guestsCanInviteOthers: true,
      guestsCanSeeOtherGuests: true,
      location: "",
      transparency: "opaque",
      visibility: "default",
      colorId: "",
      allDay: false,
      timeZone: "",
      withMeet: true,
    });
    expect(meetingOptionsSchema.parse({ location: " Studio ", colorId: "7" })).toMatchObject({ location: "Studio", colorId: "7", withMeet: true });
  });

  it("enforces at most 5 reminders, ≤ 4 weeks each, a known colour and time zone", () => {
    const r = { method: "popup", minutes: 10 };
    expect(meetingOptionsSchema.safeParse({ reminders: [r, r, r, r, r] }).success).toBe(true);
    const six = meetingOptionsSchema.safeParse({ reminders: [r, r, r, r, r, r] });
    expect(six.success).toBe(false);
    expect(six.error?.issues[0]?.message).toBe("Google Calendar allows at most 5 notifications");
    expect(meetingOptionsSchema.safeParse({ reminders: [{ method: "popup", minutes: 40321 }] }).success).toBe(false);
    expect(meetingOptionsSchema.safeParse({ reminders: [{ method: "sms", minutes: 10 }] }).success).toBe(false);
    expect(meetingOptionsSchema.safeParse({ colorId: "12" }).success).toBe(false);
    expect(meetingOptionsSchema.safeParse({ timeZone: "Mars/Olympus" }).success).toBe(false);
    expect(meetingOptionsSchema.safeParse({ timeZone: "Europe/Stockholm" }).success).toBe(true);
    // the create schema rejects six reminders too
    expect(taskInputSchema.safeParse({ title: "x", clientId: "c", type: "MEETING", meetingOptions: { reminders: [r, r, r, r, r, r] } }).success).toBe(false);
  });

  it("readMeetingOptions: stored JSON → options, junk → null", () => {
    expect(readMeetingOptions({ withMeet: false })?.withMeet).toBe(false);
    expect(readMeetingOptions(null)).toBeNull();
    expect(readMeetingOptions({ reminders: "nope" })).toBeNull();
  });

  it("addReminder stops at 5", () => {
    let list = defaultMeetingOptions().reminders;
    for (let i = 0; i < 10; i++) list = addReminder(list);
    expect(list).toHaveLength(5);
  });

  it("reminder units: split to the largest even unit and back, clamped to 0 … 4 weeks", () => {
    expect(splitReminder(10)).toEqual({ value: 10, unit: "minutes" });
    expect(splitReminder(90)).toEqual({ value: 90, unit: "minutes" });
    expect(splitReminder(120)).toEqual({ value: 2, unit: "hours" });
    expect(splitReminder(1440)).toEqual({ value: 1, unit: "days" });
    expect(splitReminder(20160)).toEqual({ value: 2, unit: "weeks" });
    expect(splitReminder(0)).toEqual({ value: 0, unit: "minutes" });
    expect(reminderMinutes(3, "hours")).toBe(180);
    expect(reminderMinutes(2, "days")).toBe(2880);
    expect(reminderMinutes(9, "weeks")).toBe(40320);
    expect(reminderMinutes(-4, "minutes")).toBe(0);
    expect(describeReminder({ method: "popup", minutes: 10 })).toBe("10 minutes before · notification");
    expect(describeReminder({ method: "email", minutes: 1440 })).toBe("1 day before · email");
  });

  it("time zone choices keep the common list and add the current / company zone", () => {
    expect(timeZoneChoices("Asia/Kolkata", "Asia/Kolkata")).toHaveLength(8);
    expect(timeZoneChoices("Asia/Tokyo", "Asia/Kolkata")[0]).toBe("Asia/Tokyo");
  });
});

describe("guest emails", () => {
  it("guestEmailsSchema trims, lowercases, dedupes and rejects invalid addresses", () => {
    expect(guestEmailsSchema.parse([" A@Repo.example", "a@repo.example", "b@x.co"])).toEqual(["a@repo.example", "b@x.co"]);
    const bad = guestEmailsSchema.safeParse(["ok@x.co", "not-an-email"]);
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toBe("Invalid guest email: not-an-email");
  });

  it("splitEmails handles comma / semicolon / space / newline separated pastes and <angle> addresses", () => {
    expect(splitEmails("a@x.co, b@y.co;c@z.co\n<d@w.co>  e@v.co")).toEqual(["a@x.co", "b@y.co", "c@z.co", "d@w.co", "e@v.co"]);
    expect(splitEmails("  ")).toEqual([]);
  });

  it("client guest emails: email plus contact when it holds addresses", () => {
    expect(clientGuestEmails({ email: "Billing@Repo.example", contact: "Asha Rao" })).toEqual(["billing@repo.example"]);
    expect(clientGuestEmails({ email: null, contact: "asha@repo.example, ops@repo.example" })).toEqual(["asha@repo.example", "ops@repo.example"]);
    expect(clientGuestEmails({ email: "a@x.co", contact: "A@x.co" })).toEqual(["a@x.co"]);
    expect(clientGuestEmails(null)).toEqual([]);
  });

  it("meetingAttendees = internal + external, deduped and lowercased", () => {
    expect(meetingAttendees(["Priya@x.co", null, "arjun@x.co"], ["PRIYA@x.co", "client@y.co", ""])).toEqual(["priya@x.co", "arjun@x.co", "client@y.co"]);
  });
});

describe("find a time: suggestSlots", () => {
  it("free day → the first three back-to-back slots from 08:00", () => {
    expect(fmt(suggestSlots([], W, 30))).toEqual(["08:00-08:30", "08:30-09:00", "09:00-09:30"]);
    expect(fmt(suggestSlots([], W, 60))).toEqual(["08:00-09:00", "09:00-10:00", "10:00-11:00"]);
  });

  it("merges overlapping blocks of different people and skips past them", () => {
    const busy = [span("08:00", "09:00"), span("08:30", "10:15"), span("11:00", "12:00"), span("10:15", "10:30")];
    expect(mergeBusy(busy).map((b) => fmt([b])[0])).toEqual(["08:00-10:30", "11:00-12:00"]);
    expect(fmt(suggestSlots(busy, W, 30))).toEqual(["10:30-11:00", "12:00-12:30", "12:30-13:00"]);
    // a 45-minute meeting doesn't fit between 10:30 and 11:00
    expect(fmt(suggestSlots(busy, W, 45))).toEqual(["12:00-12:45", "12:45-13:30", "13:30-14:15"]);
  });

  it("a block ending off the grid pushes the next start to the next quarter hour", () => {
    expect(fmt(suggestSlots([span("08:00", "09:10")], W, 30)).slice(0, 1)).toEqual(["09:15-09:45"]);
  });

  it("respects notBefore (now) and the window end", () => {
    expect(fmt(suggestSlots([], W, 30, { notBefore: T("19:52") }))).toEqual(["20:00-20:30", "20:30-21:00"]);
    expect(suggestSlots([], W, 30, { notBefore: T("21:30") })).toEqual([]);
    expect(fmt(suggestSlots([span("08:00", "20:00")], W, 60))).toEqual(["20:00-21:00"]);
  });

  it("blocks outside the window are ignored; a fully busy day has no slot", () => {
    expect(fmt(suggestSlots([span("05:00", "07:30"), span("21:00", "23:00")], W, 30)).slice(0, 1)).toEqual(["08:00-08:30"]);
    expect(suggestSlots([span("07:00", "22:00")], W, 15)).toEqual([]);
    expect(suggestSlots([], W, 14 * 60)).toEqual([]); // longer than the window
  });

  it("findTimeWindow is 08:00–21:00 in the meeting's zone", () => {
    const w = findTimeWindow("2026-10-12", "Asia/Kolkata");
    expect(w.from.toISOString()).toBe("2026-10-12T02:30:00.000Z");
    expect(w.to.toISOString()).toBe("2026-10-12T15:30:00.000Z");
    expect(findTimeWindow("2026-10-12", "Europe/London").from.toISOString()).toBe("2026-10-12T07:00:00.000Z");
  });
});
