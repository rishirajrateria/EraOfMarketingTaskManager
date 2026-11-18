import { z } from "zod";
import { fromZonedTime } from "date-fns-tz";
import { MAX_REMINDER_MINUTES, MAX_REMINDERS, meetingOptionsSchema, type MeetingOptions } from "@/server/tasks/schema";

/**
 * Meetings as Google Calendar events (ADR 0012). Pure and client-safe (no I/O): option defaults, the Google colour
 * palette, reminder units, guest-email parsing, attendee merging and the "Find a time" slot search.
 */

export type { MeetingOptions };
export type Reminder = MeetingOptions["reminders"][number];

/** Defaults match Google Calendar's own: one popup 10 minutes before, guests may invite others and see the list. */
export function defaultMeetingOptions(timeZone = ""): MeetingOptions {
  return { ...meetingOptionsSchema.parse({}), timeZone };
}

/** Stored JSON → options (unknown / invalid values fall back to the defaults). */
export function readMeetingOptions(value: unknown): MeetingOptions | null {
  if (!value || typeof value !== "object") return null;
  const parsed = meetingOptionsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Google Calendar's 11 event colours (colorId → standard hex), for the swatches. */
export const GOOGLE_EVENT_COLOURS: { id: string; name: string; hex: string }[] = [
  { id: "1", name: "Lavender", hex: "#7986cb" },
  { id: "2", name: "Sage", hex: "#33b679" },
  { id: "3", name: "Grape", hex: "#8e24aa" },
  { id: "4", name: "Flamingo", hex: "#e67c73" },
  { id: "5", name: "Banana", hex: "#f6bf26" },
  { id: "6", name: "Tangerine", hex: "#f4511e" },
  { id: "7", name: "Peacock", hex: "#039be5" },
  { id: "8", name: "Graphite", hex: "#616161" },
  { id: "9", name: "Blueberry", hex: "#3f51b5" },
  { id: "10", name: "Basil", hex: "#0b8043" },
  { id: "11", name: "Tomato", hex: "#d50000" },
];

export const COMMON_TIME_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Stockholm",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
  "Australia/Sydney",
] as const;

/** The zone select: the common zones plus the current one (and the company one) when they aren't in the list. */
export function timeZoneChoices(current: string, company: string): string[] {
  const list: string[] = [...COMMON_TIME_ZONES];
  for (const z of [company, current]) if (z && !list.includes(z)) list.unshift(z);
  return list;
}

// ---------- Reminders ----------

export type ReminderUnit = "minutes" | "hours" | "days" | "weeks";
export const REMINDER_UNITS: { unit: ReminderUnit; minutes: number }[] = [
  { unit: "weeks", minutes: 7 * 24 * 60 },
  { unit: "days", minutes: 24 * 60 },
  { unit: "hours", minutes: 60 },
  { unit: "minutes", minutes: 1 },
];

/** 1440 → { value: 1, unit: "days" }; 90 → { value: 90, unit: "minutes" } (largest unit that divides evenly). */
export function splitReminder(minutes: number): { value: number; unit: ReminderUnit } {
  if (minutes > 0) for (const u of REMINDER_UNITS) if (minutes % u.minutes === 0) return { value: minutes / u.minutes, unit: u.unit };
  return { value: Math.max(0, minutes), unit: "minutes" };
}

/** value + unit → minutes, clamped to what Calendar accepts (0 … 4 weeks). */
export function reminderMinutes(value: number, unit: ReminderUnit): number {
  const per = REMINDER_UNITS.find((u) => u.unit === unit)?.minutes ?? 1;
  const n = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.min(MAX_REMINDER_MINUTES, Math.max(0, n * per));
}

/** "10 minutes before · notification", "1 day before · email". */
export function describeReminder(r: Reminder): string {
  const { value, unit } = splitReminder(r.minutes);
  const label = value === 1 ? unit.replace(/s$/, "") : unit;
  return `${value} ${label} before · ${r.method === "email" ? "email" : "notification"}`;
}

/** Adds a reminder (default popup 10 min) unless the Calendar limit of 5 is reached. */
export function addReminder(list: Reminder[], r: Reminder = { method: "popup", minutes: 10 }): Reminder[] {
  return list.length >= MAX_REMINDERS ? list : [...list, r];
}

// ---------- Guests ----------

export const isEmail = (s: string) => z.email().safeParse(s.trim()).success;

/** Pasted / typed text → candidate addresses (comma, semicolon, whitespace or newline separated; "Name <a@b.c>" ok). */
export function splitEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.replace(/^<|>$/g, "").trim())
    .filter(Boolean);
}

/** Trim, lowercase, drop empties and duplicates (order kept). */
export function normaliseEmails(list: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const e = (raw ?? "").trim().toLowerCase();
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

/** Calendar attendees = internal people's emails + external guests, deduped and lowercased (ADR 0012). */
export function meetingAttendees(internal: (string | null | undefined)[], guests: (string | null | undefined)[]): string[] {
  return normaliseEmails([...internal, ...guests]);
}

/** A client's addresses usable as guests: `email`, plus `contact` when it holds an address. */
export function clientGuestEmails(client: { email?: string | null; contact?: string | null } | null | undefined): string[] {
  if (!client) return [];
  return normaliseEmails([client.email, ...splitEmails(client.contact ?? "")].filter((e) => !!e && isEmail(e)));
}

// ---------- Find a time ----------

/** Find-a-time window: 08:00–21:00 (minutes of day) in the meeting's time zone. */
export const FIND_TIME_WINDOW = { startMin: 8 * 60, endMin: 21 * 60 } as const;

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** The 08:00–21:00 window of `day` (yyyy-MM-dd) in `tz` as instants. */
export function findTimeWindow(day: string, tz: string): { from: Date; to: Date } {
  return { from: fromZonedTime(`${day}T${hhmm(FIND_TIME_WINDOW.startMin)}:00`, tz), to: fromZonedTime(`${day}T${hhmm(FIND_TIME_WINDOW.endMin)}:00`, tz) };
}

export type Span = { start: number; end: number }; // epoch ms

const MIN = 60_000;
const ceilTo = (t: number, stepMs: number, origin: number) => origin + Math.ceil((t - origin) / stepMs) * stepMs;

/** Sorted, merged union of busy spans (overlapping / touching spans join). */
export function mergeBusy(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/**
 * First `limit` (3) free slots of `durationMin` inside `window` where nobody in `busy` is busy. Candidates sit on a
 * `stepMin` (15-minute) grid counted from the window start, never before `notBefore`; suggestions don't overlap
 * each other (the next one starts where the previous ends), and a busy block pushes the search to its end.
 */
export function suggestSlots(busy: Span[], window: Span, durationMin: number, opts: { notBefore?: number; stepMin?: number; limit?: number } = {}): Span[] {
  const dur = Math.max(1, Math.round(durationMin)) * MIN;
  const step = Math.max(1, opts.stepMin ?? 15) * MIN;
  const limit = opts.limit ?? 3;
  const blocks = mergeBusy(busy).filter((b) => b.end > window.start && b.start < window.end);
  const out: Span[] = [];
  let t = ceilTo(Math.max(window.start, opts.notBefore ?? window.start), step, window.start);
  while (out.length < limit && t + dur <= window.end) {
    const clash = blocks.find((b) => b.start < t + dur && b.end > t);
    if (clash) {
      t = ceilTo(clash.end, step, window.start);
      continue;
    }
    out.push({ start: t, end: t + dur });
    t += dur;
  }
  return out;
}
