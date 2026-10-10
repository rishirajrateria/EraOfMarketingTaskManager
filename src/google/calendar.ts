import { randomUUID } from "crypto";
import { calendar, calendarAs, isMock, mockId, withRetry } from "@/google/client";
import type { MeetingOptions } from "@/server/tasks/schema";
import { DEFAULT_TZ } from "@/lib/time";
import { eventTimes, meetConferenceRequest, optionFields, toCalendarEventBody } from "@/google/event-body";

export type CalendarEventResult = { eventId: string; meetLink: string | null; htmlLink: string | null };

const mockMeetLink = (id: string) => `https://meet.google.com/${id.slice(-3)}-mock-${id.slice(4, 8)}`;

/**
 * Creates the event on the company calendar; Calendar emails the invites (`sendUpdates: "all"`). A Meet link comes
 * from `conferenceData.createRequest` (hangoutsMeet). Meetings pass their options (ADR 0012); work tasks don't.
 * In GOOGLE_MOCK mode nothing is sent: options are accepted and fake ids returned.
 */
export async function createEvent(opts: {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees: string[];
  withMeet: boolean;
  requestId?: string;
  /** Meeting options (reminders, permissions, location, all day, time zone, …); `withMeet` there wins. */
  options?: MeetingOptions | null;
  /** Company time zone, used when the options name none. */
  timeZone?: string;
}): Promise<CalendarEventResult> {
  const options = opts.options ? { ...opts.options, withMeet: opts.options.withMeet && opts.withMeet } : null;
  const withMeet = options ? options.withMeet : opts.withMeet;
  if (isMock()) {
    const id = mockId("evt", opts.requestId ?? `${opts.summary}${opts.start.toISOString()}`);
    return { eventId: id, meetLink: withMeet ? mockMeetLink(id) : null, htmlLink: `https://calendar.google.com/calendar/event?eid=${id}` };
  }
  const body = toCalendarEventBody(
    { summary: opts.summary, description: opts.description, start: opts.start, end: opts.end, attendees: opts.attendees, requestId: opts.requestId ?? randomUUID(), withMeet },
    options,
    opts.timeZone ?? DEFAULT_TZ,
  );
  const res = await withRetry(() => calendar().events.insert({ calendarId: "primary", conferenceDataVersion: body.conferenceDataVersion, sendUpdates: "all", requestBody: body.requestBody }));
  return {
    eventId: res.data.id!,
    meetLink: res.data.hangoutLink ?? res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null,
    htmlLink: res.data.htmlLink ?? null,
  };
}

/**
 * Patches the event; Calendar emails the guests (`sendUpdates: "all"`). With `options` the reminders, permissions,
 * location, busy / free, visibility, colour, all-day / time zone are re-applied, and `meet` adds or removes the
 * Meet conference. Returns the Meet link when one was added.
 */
export async function updateEvent(
  eventId: string,
  patch: { summary?: string; description?: string; start?: Date; end?: Date; attendees?: string[]; options?: MeetingOptions | null; timeZone?: string; meet?: "add" | "remove"; requestId?: string },
): Promise<{ meetLink: string | null } | void> {
  if (isMock()) return patch.meet === "add" ? { meetLink: mockMeetLink(mockId("evt", eventId)) } : patch.meet === "remove" ? { meetLink: null } : undefined;
  const tz = patch.timeZone ?? DEFAULT_TZ;
  const times = patch.start && patch.end ? eventTimes(patch.start, patch.end, patch.options, tz) : {
    start: patch.start ? { dateTime: patch.start.toISOString() } : undefined,
    end: patch.end ? { dateTime: patch.end.toISOString() } : undefined,
  };
  const conference = patch.meet === "add" ? meetConferenceRequest(patch.requestId ?? randomUUID()) : patch.meet === "remove" ? (null as unknown as undefined) : undefined;
  const res = await withRetry(() =>
    calendar().events.patch({
      calendarId: "primary",
      eventId,
      sendUpdates: "all",
      ...(patch.meet ? { conferenceDataVersion: 1 } : {}),
      requestBody: {
        summary: patch.summary,
        description: patch.description,
        ...times,
        attendees: patch.attendees?.map((email) => ({ email })),
        ...(patch.options ? optionFields(patch.options) : {}),
        ...(patch.meet ? { conferenceData: conference } : {}),
      },
    }),
  );
  if (!patch.meet) return;
  return { meetLink: patch.meet === "add" ? (res.data.hangoutLink ?? res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null) : null };
}

/** "Deactivate Meet": end the event now and strip conference data so the link stops working. */
export async function endEventAndRemoveMeet(eventId: string) {
  if (isMock()) return;
  const now = new Date();
  await withRetry(() =>
    calendar().events.patch({
      calendarId: "primary",
      eventId,
      conferenceDataVersion: 1,
      requestBody: { end: { dateTime: now.toISOString() }, conferenceData: null as unknown as undefined, status: "confirmed" },
    }),
  ).catch(() => undefined);
}

export async function deleteEvent(eventId: string) {
  if (isMock()) return;
  await withRetry(() => calendar().events.delete({ calendarId: "primary", eventId, sendUpdates: "all" })).catch(
    (e: unknown) => {
      const code = (e as { code?: number }).code;
      if (code !== 404 && code !== 410) throw e;
    },
  );
}

export type BusyBlock = { start: Date; end: Date };

/** Busy blocks from a user's Google Calendar (feeds availability logic, SPEC §9.2). */
export async function freeBusy(email: string, from: Date, to: Date): Promise<BusyBlock[]> {
  if (isMock()) return [];
  const res = await withRetry(() =>
    calendar().freebusy.query({
      requestBody: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: email }] },
    }),
  );
  const busy = res.data.calendars?.[email]?.busy ?? [];
  return busy.filter((b) => b.start && b.end).map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
}

/**
 * Busy blocks for several people in one freebusy query (Find a time, ADR 0012). People whose calendar can't be read
 * (not in the domain, no access) are left out of the result so the caller can fall back for them.
 */
export async function freeBusyMany(emails: string[], from: Date, to: Date): Promise<Record<string, BusyBlock[]>> {
  if (isMock() || !emails.length) return {};
  const res = await withRetry(() =>
    calendar().freebusy.query({ requestBody: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: emails.map((id) => ({ id })) } }),
  );
  const out: Record<string, BusyBlock[]> = {};
  for (const [email, cal] of Object.entries(res.data.calendars ?? {})) {
    if (cal.errors?.length) continue;
    out[email.toLowerCase()] = (cal.busy ?? []).filter((b) => b.start && b.end).map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
  }
  return out;
}

export type OutOfOfficeEvent = { id: string; summary: string; start: string; end: string; allDay: boolean };

const LEAVE_WORDS = /\b(leave|out of office|ooo|vacation|pto|off)\b/i;

/**
 * Events the user blocked in their own Google Calendar as leave (SPEC §11.5): Google's native
 * "out of office" events or any event whose title says leave/OOO/vacation. Reads the user's primary calendar
 * via domain-wide delegation.
 */
export async function listLeaveEvents(email: string, from: Date, to: Date): Promise<OutOfOfficeEvent[]> {
  if (isMock()) return [];
  const res = await withRetry(() =>
    calendarAs(email).events.list({
      calendarId: "primary",
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: true,
      maxResults: 250,
      orderBy: "startTime",
    }),
  );
  const items = res.data.items ?? [];
  return items
    .filter((e) => e.status !== "cancelled" && (e.eventType === "outOfOffice" || LEAVE_WORDS.test(e.summary ?? "")))
    .map((e) => ({
      id: e.id!,
      summary: e.summary ?? "Out of office",
      start: e.start?.date ?? e.start?.dateTime ?? "",
      end: e.end?.date ?? e.end?.dateTime ?? "",
      allDay: !!e.start?.date,
    }))
    .filter((e) => e.start && e.end);
}
