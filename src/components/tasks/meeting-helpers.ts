import { addDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TZ, dateKey } from "@/lib/time";
import type { DashboardData } from "@/server/tasks/types";
import { externalGuests, meetingInvitees, shortcutStart, type AddTaskForm } from "@/components/tasks/add-task-helpers";

/** Pure helpers for the meeting parts of the Add-task sheet (ADR 0012). No React, no server access. */

/** "Duration" pills for meetings (hours). */
export const DURATION_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

/** 0.25 → "15m", 1 → "1h", 1.5 → "1½h", 1.25 → "1h 15m". */
export function fmtDuration(hours: number): string {
  const m = Math.round(hours * 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!rest) return `${h}h`;
  if (rest === 30) return `${h}½h`;
  return `${h}h ${rest}m`;
}

/** START row: every 30 minutes from 09:00 to 20:00 (minutes of day). */
export const START_SLOTS: number[] = Array.from({ length: 23 }, (_, i) => 9 * 60 + i * 30);

/** Prototype `t12`: "9 am", "9:30 am", "12 pm", "8 pm". */
export function fmtStartPill(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h >= 12 ? "pm" : "am"}`;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** "HH:mm" → minutes of day (null if malformed). */
export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** Minutes of day of a datetime-local value, or null when none is set. */
export function startMinutes(scheduledStart: string): number | null {
  return scheduledStart.length >= 16 ? parseHHMM(scheduledStart.slice(11, 16)) : null;
}

/** The zone a meeting's start is interpreted in: its own option, else the company zone. */
export const meetingTz = (form: Pick<AddTaskForm, "meeting">, companyTz = DEFAULT_TZ) => form.meeting?.timeZone || companyTz;

/**
 * START pill → datetime-local. Keeps the day already chosen (Tom / today / calendar icon); with no day yet: today when
 * the time is still ahead, else tomorrow (in `tz`).
 */
export function pickStartTime(current: string, minutes: number, now = new Date(), tz = DEFAULT_TZ): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(current)) return `${current.slice(0, 10)}T${hhmm(minutes)}`;
  const nowMin = Number(formatInTimeZone(now, tz, "H")) * 60 + Number(formatInTimeZone(now, tz, "m"));
  const day = minutes > nowMin ? dateKey(now, tz) : dateKey(addDays(now, 1), tz);
  return `${day}T${hhmm(minutes)}`;
}

/** Day key for Tom / today (in `tz`). */
export const shortcutDay = (kind: "tomorrow" | "today", now = new Date(), tz = DEFAULT_TZ) => dateKey(kind === "tomorrow" ? addDays(now, 1) : now, tz);

/** Meetings: Tom / today change only the day once a START time is chosen; otherwise they behave as for tasks. */
export function meetingShortcut(kind: "tomorrow" | "today", current: string, now = new Date(), tz = DEFAULT_TZ): string {
  const min = startMinutes(current);
  if (min === null) return shortcutStart(kind, now, tz);
  return `${shortcutDay(kind, now, tz)}T${hhmm(min)}`;
}

/** Is Tom / today the chosen day of this meeting? */
export const isShortcutDay = (kind: "tomorrow" | "today", scheduledStart: string, now = new Date(), tz = DEFAULT_TZ) =>
  !!scheduledStart && scheduledStart.slice(0, 10) === shortcutDay(kind, now, tz);

// ---------- Guests ----------

export const clientEmails = (data: Pick<DashboardData, "clients">, clientId: string) => data.clients.find((c) => c.id === clientId)?.emails ?? [];

/** CLIENT pill: on a meeting, picking a client adds its addresses as guests; deselecting removes them. */
export function pickClient(form: Pick<AddTaskForm, "type" | "clientId">, data: Pick<DashboardData, "clients">, clientId: string): Pick<AddTaskForm, "clientId" | "clientGuests"> {
  const next = form.clientId === clientId ? "" : clientId;
  return { clientId: next, clientGuests: form.type === "MEETING" && next ? clientEmails(data, next) : [] };
}

/** People invited besides me + external guests (the badge on the people glyph and the summary line). */
export function guestCount(form: Pick<AddTaskForm, "teamIds" | "assigneeIds" | "clientGuests" | "guestEmails">, data: Pick<DashboardData, "people" | "me">): number {
  return meetingInvitees(form, data).filter((id) => id !== data.me.id).length + externalGuests(form).length;
}

/** Voice notes are never uploaded for meetings (the description is the agenda). */
export function voiceNotesFor<T>(type: AddTaskForm["type"], notes: T[]): T[] {
  return type === "MEETING" ? [] : notes;
}

/** The day Find a time looks at: the chosen start day, else today (meeting zone). */
export const findTimeDay = (form: Pick<AddTaskForm, "scheduledStart" | "meeting">, now = new Date(), companyTz = DEFAULT_TZ) =>
  /^\d{4}-\d{2}-\d{2}/.test(form.scheduledStart) ? form.scheduledStart.slice(0, 10) : dateKey(now, meetingTz(form, companyTz));

/** A suggested slot → the datetime-local value for that start in the meeting zone. */
export const slotToLocal = (start: number, zone: string) => formatInTimeZone(new Date(start), zone, "yyyy-MM-dd'T'HH:mm");
