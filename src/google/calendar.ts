import { randomUUID } from "crypto";
import { calendar, isMock, mockId, withRetry } from "@/google/client";

export type CalendarEventResult = { eventId: string; meetLink: string | null; htmlLink: string | null };

export async function createEvent(opts: {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees: string[];
  withMeet: boolean;
  requestId?: string;
}): Promise<CalendarEventResult> {
  if (isMock()) {
    const id = mockId("evt", opts.requestId ?? `${opts.summary}${opts.start.toISOString()}`);
    return {
      eventId: id,
      meetLink: opts.withMeet ? `https://meet.google.com/${id.slice(-3)}-mock-${id.slice(4, 8)}` : null,
      htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`,
    };
  }
  const res = await withRetry(() =>
    calendar().events.insert({
      calendarId: "primary",
      conferenceDataVersion: opts.withMeet ? 1 : 0,
      sendUpdates: "all",
      requestBody: {
        summary: opts.summary,
        description: opts.description,
        start: { dateTime: opts.start.toISOString() },
        end: { dateTime: opts.end.toISOString() },
        attendees: opts.attendees.map((email) => ({ email })),
        conferenceData: opts.withMeet
          ? { createRequest: { requestId: opts.requestId ?? randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
          : undefined,
      },
    }),
  );
  return {
    eventId: res.data.id!,
    meetLink: res.data.hangoutLink ?? res.data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? null,
    htmlLink: res.data.htmlLink ?? null,
  };
}

export async function updateEvent(
  eventId: string,
  patch: { summary?: string; description?: string; start?: Date; end?: Date; attendees?: string[] },
) {
  if (isMock()) return;
  await withRetry(() =>
    calendar().events.patch({
      calendarId: "primary",
      eventId,
      sendUpdates: "all",
      requestBody: {
        summary: patch.summary,
        description: patch.description,
        start: patch.start ? { dateTime: patch.start.toISOString() } : undefined,
        end: patch.end ? { dateTime: patch.end.toISOString() } : undefined,
        attendees: patch.attendees?.map((email) => ({ email })),
      },
    }),
  );
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
