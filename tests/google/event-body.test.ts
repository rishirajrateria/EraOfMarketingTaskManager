import { describe, expect, it } from "vitest";
import { eventTimes, toCalendarEventBody } from "@/google/event-body";
import { defaultMeetingOptions } from "@/server/tasks/meeting";
import type { MeetingOptions } from "@/server/tasks/schema";

const TZ = "Asia/Kolkata";
// 2026-10-12 16:00–16:30 IST
const start = new Date("2026-10-12T10:30:00Z");
const end = new Date("2026-10-12T11:00:00Z");
const task = { summary: "Meeting: Kickoff", description: "Repo\nAgenda", start, end, attendees: ["Priya@Example.com", "arjun@example.com", "priya@example.com", "Client@Repo.example"], requestId: "task-1" };
const opts = (p: Partial<MeetingOptions> = {}): MeetingOptions => ({ ...defaultMeetingOptions(), ...p });

describe("toCalendarEventBody (ADR 0012)", () => {
  it("work tasks (no options): dateTime times, attendees, a Meet request — as before", () => {
    const { requestBody, conferenceDataVersion } = toCalendarEventBody(task, null, TZ);
    expect(conferenceDataVersion).toBe(1);
    expect(requestBody.start).toEqual({ dateTime: start.toISOString() });
    expect(requestBody.end).toEqual({ dateTime: end.toISOString() });
    expect(requestBody.conferenceData).toEqual({ createRequest: { requestId: "task-1", conferenceSolutionKey: { type: "hangoutsMeet" } } });
    expect(requestBody.reminders).toBeUndefined();
    expect(requestBody.visibility).toBeUndefined();
    const plain = toCalendarEventBody({ ...task, withMeet: false }, null, TZ);
    expect(plain.conferenceDataVersion).toBe(0);
    expect(plain.requestBody.conferenceData).toBeUndefined();
  });

  it("attendees are lowercased and deduped", () => {
    const { requestBody } = toCalendarEventBody(task, opts(), TZ);
    expect(requestBody.attendees).toEqual([{ email: "priya@example.com" }, { email: "arjun@example.com" }, { email: "client@repo.example" }]);
  });

  it("defaults: one popup 10 min before, guests may invite others and see the list, busy, default visibility, Meet", () => {
    const { requestBody, conferenceDataVersion } = toCalendarEventBody(task, opts(), TZ);
    expect(requestBody.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 10 }] });
    expect(requestBody).toMatchObject({ guestsCanModify: false, guestsCanInviteOthers: true, guestsCanSeeOtherGuests: true, transparency: "opaque", visibility: "default", colorId: null, location: "" });
    expect(requestBody.start).toEqual({ dateTime: start.toISOString(), timeZone: TZ });
    expect(conferenceDataVersion).toBe(1);
    expect(requestBody.conferenceData?.createRequest?.conferenceSolutionKey?.type).toBe("hangoutsMeet");
  });

  it("maps reminders (popup / email, any unit) and caps them at 5", () => {
    const reminders = [
      { method: "popup" as const, minutes: 10 },
      { method: "email" as const, minutes: 60 },
      { method: "email" as const, minutes: 1440 },
      { method: "popup" as const, minutes: 10080 },
      { method: "popup" as const, minutes: 0 },
      { method: "popup" as const, minutes: 5 },
    ];
    const { requestBody } = toCalendarEventBody(task, opts({ reminders }), TZ);
    expect(requestBody.reminders?.overrides).toEqual(reminders.slice(0, 5));
    expect(toCalendarEventBody(task, opts({ reminders: [] }), TZ).requestBody.reminders).toEqual({ useDefault: false, overrides: [] });
  });

  it("maps guest permissions, location, busy / free, visibility and colour", () => {
    const { requestBody } = toCalendarEventBody(
      task,
      opts({ guestsCanModify: true, guestsCanInviteOthers: false, guestsCanSeeOtherGuests: false, location: "Studio 2, Bengaluru", transparency: "transparent", visibility: "private", colorId: "11" }),
      TZ,
    );
    expect(requestBody).toMatchObject({
      guestsCanModify: true,
      guestsCanInviteOthers: false,
      guestsCanSeeOtherGuests: false,
      location: "Studio 2, Bengaluru",
      transparency: "transparent",
      visibility: "private",
      colorId: "11",
    });
    expect(toCalendarEventBody(task, opts({ visibility: "public", colorId: "1" }), TZ).requestBody).toMatchObject({ visibility: "public", colorId: "1" });
  });

  it("withMeet off makes a plain event (no conference, version 0)", () => {
    const { requestBody, conferenceDataVersion } = toCalendarEventBody(task, opts({ withMeet: false }), TZ);
    expect(conferenceDataVersion).toBe(0);
    expect(requestBody.conferenceData).toBeUndefined();
  });

  it("all day: {date} start and an exclusive next-day end in the meeting zone", () => {
    const { requestBody } = toCalendarEventBody(task, opts({ allDay: true }), TZ);
    expect(requestBody.start).toEqual({ date: "2026-10-12" });
    expect(requestBody.end).toEqual({ date: "2026-10-13" });
    // late evening UTC is already the next day in Kolkata; a two-day span ends the day after the last day
    const s2 = new Date("2026-10-31T20:00:00Z"); // 1 Nov 01:30 IST
    expect(eventTimes(s2, new Date(s2.getTime() + 36 * 3600_000), { allDay: true, timeZone: "" }, TZ)).toEqual({ start: { date: "2026-11-01" }, end: { date: "2026-11-03" } });
    // month / year rollover
    expect(eventTimes(new Date("2026-12-31T06:00:00Z"), new Date("2026-12-31T07:00:00Z"), { allDay: true, timeZone: "" }, TZ)).toEqual({ start: { date: "2026-12-31" }, end: { date: "2027-01-01" } });
  });

  it("time zone: the option wins over the company zone, for dateTime and all-day dates", () => {
    expect(toCalendarEventBody(task, opts({ timeZone: "Europe/London" }), TZ).requestBody.start).toEqual({ dateTime: start.toISOString(), timeZone: "Europe/London" });
    // 2026-10-12 21:00 UTC = 13 Oct in Kolkata but still 12 Oct in New York
    const late = new Date("2026-10-12T21:00:00Z");
    expect(eventTimes(late, new Date(late.getTime() + 1800_000), { allDay: true, timeZone: "America/New_York" }, TZ).start).toEqual({ date: "2026-10-12" });
    expect(eventTimes(late, new Date(late.getTime() + 1800_000), { allDay: true, timeZone: "" }, TZ).start).toEqual({ date: "2026-10-13" });
  });
});
