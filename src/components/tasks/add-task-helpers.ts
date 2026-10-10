import { addDays, differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { DEFAULT_TZ, dateKey, zonedDayAt } from "@/lib/time";
import type { DashboardData } from "@/server/tasks/types";
import type { RepeatRule } from "@/server/tasks/repeat-rule";
import type { MeetingOptions } from "@/server/tasks/schema";
import { defaultMeetingOptions, normaliseEmails } from "@/server/tasks/meeting";

/** Pure helpers for the Add-task sheet (SPEC §6). No React, no server access — unit-tested in tests/ui. */

export type TaskMode = "WORK" | "MEETING";
export type Person = DashboardData["people"][number];

/** "Repeat this task" rule (ADR 0010); the server anchors it on the first occurrence's day. */
export type Recurrence = RepeatRule;

export type AddTaskForm = {
  type: TaskMode;
  title: string;
  description: string;
  clientId: string;
  assigneeIds: string[];
  teamIds: string[];
  tagIds: string[]; // the WORK row: exactly one work type for work tasks
  /** Admin's PREFER row: suggested executives; the Team Leader decides (ADR 0008). */
  preferredAssigneeIds: string[];
  /** "How long": hours in 15-minute steps (min ¼h). */
  hours: number;
  /** datetime-local value (company tz) set from the calendar icon / Tom / today; "" = next free slot (upnext). */
  scheduledStart: string;
  important: boolean;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  recurrence: Recurrence | null;
  /** Meetings (ADR 0012): the client's addresses, added when the client is picked (removable in the Guests sheet). */
  clientGuests: string[];
  /** Meetings: external guests typed in the Guests sheet. */
  guestEmails: string[];
  /** Meetings: Google Calendar options (Options sheet). `timeZone: ""` = the company time zone. */
  meeting: MeetingOptions;
};

/** Header capacity of the selected team(s) for one period: hours left (inventory), hours booked, tasks booked. */
export type PeriodLoad = { leftMinutes: number; bookedMinutes: number; count: number };
export type PeriodLoads = Record<"today" | "tomorrow" | "week" | "month", PeriodLoad>;
const NO_LOAD: PeriodLoad = { leftMinutes: 0, bookedMinutes: 0, count: 0 };
export const EMPTY_LOADS: PeriodLoads = { today: NO_LOAD, tomorrow: NO_LOAD, week: NO_LOAD, month: NO_LOAD };

/** Minutes → compact hours for the header: 90 → "1.5h", 20 → "0.3h", 0 → "0h"; 10h and more are whole ("141h"). */
export function fmtShortHours(minutes: number): string {
  const raw = minutes / 60;
  if (raw >= 10) return `${Math.round(raw)}h`;
  const h = Math.round(raw * 10) / 10;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

/**
 * Fresh form. Admin and Team Leader start with nobody picked (Admin: the chosen team's Team Leader gets it;
 * Team Leader: none picked = the whole team); Executives (and callers that pass no role) start with themselves.
 */
export function emptyForm(type: TaskMode, meId: string, role?: string): AddTaskForm {
  return {
    type,
    title: "",
    description: "",
    clientId: "",
    assigneeIds: role === "ADMIN" || role === "TEAM_LEADER" ? [] : [meId],
    teamIds: [],
    tagIds: [],
    preferredAssigneeIds: [],
    hours: type === "MEETING" ? 0.5 : 2, // meetings: "Duration", 30 minutes by default
    scheduledStart: "",
    important: false,
    priority: "NORMAL",
    recurrence: null,
    clientGuests: [],
    guestEmails: [],
    meeting: defaultMeetingOptions(),
  };
}

/** Date/ISO → value for an `<input type="datetime-local">` expressed in the company timezone. */
export function toDatetimeLocal(d: Date | string | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "";
  return formatInTimeZone(date, tz, "yyyy-MM-dd'T'HH:mm");
}

/** datetime-local value (company tz) → ISO 8601 with numeric offset, e.g. 2026-09-12T10:00:00+05:30. */
export function fromDatetimeLocal(value: string, tz = DEFAULT_TZ): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const instant = fromZonedTime(value.length === 16 ? `${value}:00` : value, tz);
  if (Number.isNaN(instant.getTime())) return null;
  return formatInTimeZone(instant, tz, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

/** Hours input ("1.5") → whole minutes, never below the schema minimum (5). */
export function hoursToMinutes(hours: string | number): number {
  const h = typeof hours === "number" ? hours : Number.parseFloat(hours);
  if (!Number.isFinite(h) || h <= 0) return 5;
  return Math.max(5, Math.round(h * 60));
}

/** "How long" quick pills (prototype `renderAdd`). */
export const HOUR_PRESETS = [0.5, 1, 2, 3, 4, 6, 8] as const;

/** 0.5 → "½h", 2 → "2h", 1.25 → "1.25h", 1.5 → "1.5h". */
export function fmtHours(h: number): string {
  if (h === 0.5) return "½h";
  return `${Number.isInteger(h) ? h : h.toFixed(2).replace(/0$/, "")}h`;
}

/** − / + stepper: 15-minute steps, never below 15 minutes. */
export function stepHours(h: number, dir: 1 | -1): number {
  return Math.max(0.25, Math.round((h + dir * 0.25) * 4) / 4);
}

/** Seconds → "1:05" (voice-note timer and chips). */
export const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Day key the repeat presets are based on: the picked start day, else today (company tz). */
export function repeatBaseDay(form: Pick<AddTaskForm, "scheduledStart">, now = new Date(), tz = DEFAULT_TZ): string {
  return /^\d{4}-\d{2}-\d{2}/.test(form.scheduledStart) ? form.scheduledStart.slice(0, 10) : dateKey(now, tz);
}

/**
 * Who the current user may assign (SPEC §2).
 * Admin → Team Leaders + self; Team Leader → own Executives + self; Executive → self only.
 * Meetings may be scheduled with anyone who has a dashboard role.
 */
export function allowedAssignees(data: Pick<DashboardData, "people" | "me">, mode: TaskMode = "WORK"): Person[] {
  const { people, me } = data;
  const self: Person = people.find((p) => p.id === me.id) ?? { id: me.id, name: "Me", role: me.role, teamId: me.teamId, teamLeaderId: null, specialityIds: [] };
  const others = people.filter((p) => p.id !== me.id);
  let allowed: Person[];
  if (mode === "MEETING") allowed = others;
  else if (me.role === "ADMIN") allowed = others.filter((p) => p.role === "TEAM_LEADER");
  else if (me.role === "TEAM_LEADER") allowed = others.filter((p) => p.role === "EXECUTIVE" && p.teamLeaderId === me.id);
  else allowed = [];
  return [self, ...allowed];
}

/** Default team selection = the distinct teams of the selected assignees (only teams that exist). */
export function defaultTeamIds(data: Pick<DashboardData, "people" | "teams" | "me">, assigneeIds: string[]): string[] {
  const known = new Set(data.teams.map((t) => t.id));
  const out: string[] = [];
  for (const id of assigneeIds) {
    const teamId = id === data.me.id ? (data.people.find((p) => p.id === id)?.teamId ?? data.me.teamId) : data.people.find((p) => p.id === id)?.teamId;
    if (teamId && known.has(teamId) && !out.includes(teamId)) out.push(teamId);
  }
  return out;
}

/** Bottom-bar date shortcuts: Tom = tomorrow 10:00, Today = next full hour (company tz). Returns a datetime-local value. */
export function shortcutStart(kind: "tomorrow" | "today", now = new Date(), tz = DEFAULT_TZ): string {
  if (kind === "tomorrow") return toDatetimeLocal(zonedDayAt(addDays(now, 1), 10 * 60, tz), tz);
  const local = toZonedTime(now, tz);
  return toDatetimeLocal(zonedDayAt(now, (local.getHours() + 1) * 60, tz), tz);
}

/** "Thu 12 Sep 10:00am – 2:00pm" or "Thu 12 Sep 10:00am – Fri 13 Sep 2:00pm (spans 2 days)". */
export function formatSlot(slot: { start: Date | string; end: Date | string }, tz = DEFAULT_TZ): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const days = differenceInCalendarDays(toZonedTime(end, tz), toZonedTime(start, tz)) + 1;
  const time = (d: Date) => formatInTimeZone(d, tz, "h:mma").toLowerCase();
  const day = (d: Date) => formatInTimeZone(d, tz, "EEE d MMM");
  if (days <= 1) return `${day(start)} ${time(start)} – ${time(end)}`;
  return `${day(start)} ${time(start)} – ${day(end)} ${time(end)} (spans ${days} days)`;
}

/** Form state → payload for `createTask` (matches `taskInputSchema`). */
export function toTaskInput(form: AddTaskForm, tz = DEFAULT_TZ) {
  const meeting = form.type === "MEETING";
  // Meetings: the start is interpreted in the meeting's time zone; all-day meetings start at that day's midnight.
  const zone = meeting ? form.meeting?.timeZone || tz : tz;
  const allDay = meeting && !!form.meeting?.allDay;
  const allDayKey = /^\d{4}-\d{2}-\d{2}/.test(form.scheduledStart) ? form.scheduledStart.slice(0, 10) : dateKey(new Date(), zone);
  const scheduledStart = fromDatetimeLocal(allDay ? `${allDayKey}T00:00` : form.scheduledStart, zone);
  return {
    type: form.type,
    title: form.title.trim(),
    description: form.description,
    clientId: form.clientId,
    assigneeIds: form.assigneeIds,
    teamIds: form.teamIds,
    tagIds: meeting ? [] : form.tagIds,
    preferredAssigneeIds: form.preferredAssigneeIds ?? [],
    allocatedMinutes: hoursToMinutes(form.hours),
    scheduledStart,
    scheduledEnd: null, // the server ends it after the allocated time
    important: false, // the ★ Important chip is gone (ADR 0015); the column stays
    priority: form.priority,
    recurrence: !form.recurrence ? null : { ...form.recurrence, trigger: "ON_SCHEDULE" as const },
    guestEmails: meeting ? externalGuests(form) : [],
    meetingOptions: meeting ? { ...(form.meeting ?? defaultMeetingOptions()), timeZone: zone } : null,
  };
}

export type AddTaskErrorKey = "title" | "teamIds" | "tagIds" | "clientId" | "assigneeIds" | "hours";
export type AddTaskErrors = Partial<Record<AddTaskErrorKey, string>>;

/**
 * Client-side pre-check mirroring the server rules so they can be highlighted before the round trip.
 * With `data` it also applies the team-first rules (ADR 0008) in the prototype's order: title, team, work, client.
 */
export function validateForm(form: AddTaskForm, data?: AddTaskData): AddTaskErrors {
  const errors: AddTaskErrors = {};
  if (!form.title.trim()) errors.title = "Title is required";
  if (form.type === "MEETING") return validateMeeting(form, errors, data);
  if (data?.me.role === "ADMIN" && !form.teamIds.length) errors.teamIds = "Pick a team in the rows below";
  if (data && form.type === "WORK" && !errors.teamIds && !workTypesFor(data.workTypes, workTeamIds(form, data)).some((w) => w.id === form.tagIds[0])) {
    errors.tagIds = "Pick a work type in the rows below";
  }
  if (!form.clientId) errors.clientId = data ? "Pick a client in the rows below" : "Client is required";
  const assignees = data ? effectiveAssignees(form, data) : form.assigneeIds;
  if (!assignees.length && !errors.teamIds) {
    errors.assigneeIds = data?.me.role === "ADMIN" ? "That team has no Team Leader yet (Menu → Add teamleader)" : "At least one assignee is required";
  }
  if (!Number.isFinite(form.hours) || form.hours < 0.25) errors.hours = "Pick how long it takes (at least 15 minutes)";
  return errors;
}

/** Meetings (ADR 0012): no team needed, but someone besides the organiser (a team, people or a guest email). */
function validateMeeting(form: AddTaskForm, errors: AddTaskErrors, data?: AddTaskData): AddTaskErrors {
  if (!form.clientId) errors.clientId = data ? "Pick a client in the rows below" : "Client is required";
  const invitees = data ? meetingInvitees(form, data) : form.assigneeIds;
  const others = data ? invitees.filter((id) => id !== data.me.id) : invitees;
  if (!others.length && !externalGuests(form).length) errors.assigneeIds = "Invite someone: pick a team, people or add a guest email";
  if (!Number.isFinite(form.hours) || form.hours < 0.25) errors.hours = "Pick the duration (at least 15 minutes)";
  return errors;
}

/** Meetings: external guests = the client's (kept) addresses + typed ones, lowercased and deduped. */
export function externalGuests(form: Pick<AddTaskForm, "clientGuests" | "guestEmails">): string[] {
  return normaliseEmails([...(form.clientGuests ?? []), ...(form.guestEmails ?? [])]);
}

/** Meeting invitees (internal): me (the organiser) + the invited teams' Team Leaders + the people picked in Guests. */
export function meetingInvitees(form: Pick<AddTaskForm, "teamIds" | "assigneeIds">, data: Pick<DashboardData, "people" | "me">): string[] {
  return Array.from(new Set([data.me.id, ...teamLeadersOf(data, form.teamIds).map((p) => p.id), ...form.assigneeIds]));
}

export function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** The Team Leader of a team (Admin tag row auto-assigns them when the team pill is tapped). */
export function teamLeaderId(data: Pick<DashboardData, "people">, teamId: string): string | null {
  return data.people.find((p) => p.role === "TEAM_LEADER" && p.teamId === teamId)?.id ?? null;
}

/** `?add=WORK|MEETING|CHOOSE` → sheet mode (used to deep-link the add sheet). */
export function parseAddParam(value: string | null | undefined): "WORK" | "MEETING" | "CHOOSE" | null {
  return value === "WORK" || value === "MEETING" || value === "CHOOSE" ? value : null;
}

// ---------- Team-first assignment (ADR 0008) ----------

export type WorkTypeOpt = DashboardData["workTypes"][number];
export type AddTaskData = Pick<DashboardData, "people" | "me" | "workTypes">;

/** Work types done by any of `teamIds`; a work type with no teams (legacy) is available to every team. */
export function workTypesFor(workTypes: WorkTypeOpt[], teamIds: string[]): WorkTypeOpt[] {
  return workTypes.filter((w) => !w.teamIds.length || w.teamIds.some((t) => teamIds.includes(t)));
}

export const isSpecialist = (p: Pick<Person, "specialityIds"> | undefined, workId: string | null | undefined) => !!workId && !!p?.specialityIds.includes(workId);

/** Stable sort: specialists in `workId` first. */
export function specialistsFirst<T extends Pick<Person, "specialityIds">>(list: T[], workId: string | null | undefined): T[] {
  return [...list].sort((a, b) => Number(isSpecialist(b, workId)) - Number(isSpecialist(a, workId)));
}

export const teamLeadersOf = (data: Pick<DashboardData, "people">, teamIds: string[]) => data.people.filter((p) => p.role === "TEAM_LEADER" && !!p.teamId && teamIds.includes(p.teamId));
export const executivesOf = (data: Pick<DashboardData, "people">, teamIds: string[]) => data.people.filter((p) => p.role === "EXECUTIVE" && !!p.teamId && teamIds.includes(p.teamId));

/** Teams whose work types the WORK row shows: Admin → the picked teams; everyone else → their own team. */
export function workTeamIds(form: Pick<AddTaskForm, "teamIds">, data: Pick<DashboardData, "me">): string[] {
  if (data.me.role === "ADMIN") return form.teamIds;
  return data.me.teamId ? [data.me.teamId] : [];
}

/** WORK is single-select: keep the current work type while it belongs to the teams, else auto-select the first. */
export function syncWorkType(form: AddTaskForm, data: AddTaskData): string[] {
  const list = workTypesFor(data.workTypes, workTeamIds(form, data));
  if (data.me.role === "ADMIN" && !form.teamIds.length) return [];
  const current = form.tagIds[0];
  if (current && list.some((w) => w.id === current)) return [current];
  return list[0] ? [list[0].id] : [];
}

/** Admin TEAM pill: toggles the team and drops preferred executives who are no longer in a picked team. */
export function toggleAdminTeam(form: Pick<AddTaskForm, "teamIds" | "preferredAssigneeIds">, data: Pick<DashboardData, "people">, teamId: string) {
  const teamIds = toggleId(form.teamIds, teamId);
  const keep = new Set(executivesOf(data, teamIds).map((p) => p.id));
  return { teamIds, preferredAssigneeIds: form.preferredAssigneeIds.filter((id) => keep.has(id)) };
}

/**
 * Who the task is actually assigned to. Meetings → `meetingInvitees` (me + invited teams + picked people, ADR 0012).
 * Work: Admin → the picked teams' Team Leaders; Team Leader → the EXEC row picks, or the whole team when none are
 * picked; Executive → self.
 */
export function effectiveAssignees(form: Pick<AddTaskForm, "type" | "teamIds" | "assigneeIds">, data: Pick<DashboardData, "people" | "me">): string[] {
  const { me } = data;
  if (form.type === "MEETING") return meetingInvitees(form, data);
  if (me.role === "ADMIN") return teamLeadersOf(data, form.teamIds).map((p) => p.id);
  if (me.role === "TEAM_LEADER") {
    if (form.assigneeIds.length) return form.assigneeIds;
    const team = me.teamId ? executivesOf(data, [me.teamId]).map((p) => p.id) : [];
    return team.length ? team : [me.id];
  }
  return [me.id];
}

/**
 * Teams the capacity header shows (hidden while empty): Admin → the teams picked in the TEAM row; Team Leader /
 * Executive → their own team (none → hidden).
 */
export function headerTeamIds(form: Pick<AddTaskForm, "teamIds">, data: Pick<DashboardData, "me">): string[] {
  if (data.me.role === "ADMIN") return form.teamIds;
  return data.me.teamId ? [data.me.teamId] : [];
}
