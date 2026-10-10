import type { calendar_v3 } from "googleapis";
import { formatInTimeZone } from "date-fns-tz";
import { MAX_REMINDERS, type MeetingOptions } from "@/server/tasks/schema";
import { meetingAttendees } from "@/server/tasks/meeting";

/**
 * Task / meeting → Google Calendar event body (ADR 0012). Pure: no I/O, unit-tested in tests/google.
 * Without options (work tasks) the body is what it always was: summary, description, dateTime start / end, attendees,
 * and a Meet link. With meeting options every option maps onto its Calendar field.
 */

export type EventTaskInput = {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees: string[];
  /** Idempotency key for the Meet conference request (default: derived from the start time). */
  requestId?: string;
  /** Work tasks (no options): add a Meet link? Default true. Meetings use `options.withMeet`. */
  withMeet?: boolean;
};

export type CalendarEventBody = { requestBody: calendar_v3.Schema$Event; conferenceDataVersion: 0 | 1 };

const dayKey = (d: Date, tz: string) => formatInTimeZone(d, tz, "yyyy-MM-dd");
/** yyyy-MM-dd + n days (pure calendar arithmetic, independent of the host time zone). */
const plusDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function meetConferenceRequest(requestId: string): calendar_v3.Schema$ConferenceData {
  return { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } };
}

/**
 * Start / end: `{ dateTime, timeZone }`, or for all-day meetings `{ date }` with an exclusive end date (the day after
 * the last day — a one-day meeting ends the next day, as Calendar expects).
 */
export function eventTimes(start: Date, end: Date, options: Pick<MeetingOptions, "allDay" | "timeZone"> | null | undefined, tz: string) {
  if (!options) return { start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
  const zone = options.timeZone || tz;
  if (options.allDay) {
    const first = dayKey(start, zone);
    const last = end.getTime() > start.getTime() ? dayKey(new Date(end.getTime() - 1), zone) : first;
    return { start: { date: first }, end: { date: plusDays(last > first ? last : first, 1) } };
  }
  return { start: { dateTime: start.toISOString(), timeZone: zone }, end: { dateTime: end.toISOString(), timeZone: zone } };
}

/** The option fields only (reminders, permissions, location, busy / free, visibility, colour). */
export function optionFields(options: MeetingOptions): calendar_v3.Schema$Event {
  return {
    reminders: { useDefault: false, overrides: options.reminders.slice(0, MAX_REMINDERS).map((r) => ({ method: r.method, minutes: r.minutes })) },
    guestsCanModify: options.guestsCanModify,
    guestsCanInviteOthers: options.guestsCanInviteOthers,
    guestsCanSeeOtherGuests: options.guestsCanSeeOtherGuests,
    location: options.location,
    transparency: options.transparency,
    visibility: options.visibility,
    colorId: options.colorId || null,
  };
}

export function toCalendarEventBody(task: EventTaskInput, options: MeetingOptions | null | undefined, tz: string): CalendarEventBody {
  const withMeet = options ? options.withMeet : (task.withMeet ?? true);
  const requestBody: calendar_v3.Schema$Event = {
    summary: task.summary,
    description: task.description,
    ...eventTimes(task.start, task.end, options, tz),
    attendees: meetingAttendees(task.attendees, []).map((email) => ({ email })),
    ...(options ? optionFields(options) : {}),
  };
  if (withMeet) requestBody.conferenceData = meetConferenceRequest(task.requestId ?? `evt-${task.start.getTime()}`);
  return { requestBody, conferenceDataVersion: withMeet ? 1 : 0 };
}
