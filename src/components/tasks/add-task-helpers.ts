import { addDays, differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { DEFAULT_TZ, zonedDayAt } from "@/lib/time";
import type { DashboardData } from "@/server/tasks/types";

/** Pure helpers for the Add-task sheet (SPEC §6). No React, no server access — unit-tested in tests/ui. */

export type TaskMode = "WORK" | "MEETING";
export type Person = DashboardData["people"][number];

export type Recurrence = {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";
  interval: number;
  byWeekday: number[];
  trigger: "ON_SCHEDULE" | "ON_COMPLETE";
  endDate: string | null; // yyyy-MM-dd, null = infinite
};

export type AddTaskForm = {
  type: TaskMode;
  title: string;
  description: string;
  clientId: string;
  assigneeIds: string[];
  teamIds: string[];
  tagIds: string[];
  allocatedHours: string; // "1.5"
  scheduledStart: string; // datetime-local value or ""
  scheduledEnd: string;
  important: boolean;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  recurrence: Recurrence | null;
  acceptProposedSlot: boolean;
};

export type PeriodLoad = { minutes: number; count: number };
export type PeriodLoads = Record<"today" | "tomorrow" | "week" | "month", PeriodLoad>;
export const EMPTY_LOADS: PeriodLoads = {
  today: { minutes: 0, count: 0 },
  tomorrow: { minutes: 0, count: 0 },
  week: { minutes: 0, count: 0 },
  month: { minutes: 0, count: 0 },
};

export const DEFAULT_RECURRENCE: Recurrence = { frequency: "WEEKLY", interval: 1, byWeekday: [], trigger: "ON_SCHEDULE", endDate: null };

export function emptyForm(type: TaskMode, meId: string): AddTaskForm {
  return {
    type,
    title: "",
    description: "",
    clientId: "",
    assigneeIds: [meId],
    teamIds: [],
    tagIds: [],
    allocatedHours: "1",
    scheduledStart: "",
    scheduledEnd: "",
    important: false,
    priority: "NORMAL",
    recurrence: null,
    acceptProposedSlot: false, // becomes true once the creator taps Accept on the proposed slot
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

/** Minutes → "5.5 Hours" / "1 Hour" for the header tiles. */
export function fmtLoadHours(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  const text = Number.isInteger(h) ? String(h) : h.toFixed(1);
  return `${text} ${h === 1 ? "Hour" : "Hours"}`;
}

/**
 * Who the current user may assign (SPEC §2).
 * Admin → Team Leaders + self; Team Leader → own Executives + self; Executive → self only.
 * Meetings may be scheduled with anyone who has a dashboard role.
 */
export function allowedAssignees(data: Pick<DashboardData, "people" | "me">, mode: TaskMode = "WORK"): Person[] {
  const { people, me } = data;
  const self: Person = people.find((p) => p.id === me.id) ?? { id: me.id, name: "Me", role: me.role, teamId: me.teamId, teamLeaderId: null };
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
  const scheduledStart = fromDatetimeLocal(form.scheduledStart, tz);
  const scheduledEnd = scheduledStart ? fromDatetimeLocal(form.scheduledEnd, tz) : null;
  const meeting = form.type === "MEETING";
  return {
    type: form.type,
    title: form.title.trim(),
    description: form.description,
    clientId: form.clientId,
    assigneeIds: form.assigneeIds,
    teamIds: form.teamIds,
    tagIds: meeting ? [] : form.tagIds,
    allocatedMinutes: hoursToMinutes(form.allocatedHours),
    scheduledStart,
    scheduledEnd: scheduledEnd && scheduledEnd > scheduledStart! ? scheduledEnd : null,
    important: form.important,
    priority: form.priority,
    recurrence: meeting ? null : form.recurrence,
    acceptProposedSlot: !scheduledStart && form.acceptProposedSlot,
  };
}

/** Client-side pre-check mirroring the mandatory fields so we can highlight them inline before the round trip. */
export function validateForm(form: AddTaskForm): Partial<Record<"title" | "clientId" | "assigneeIds" | "allocatedHours", string>> {
  const errors: Partial<Record<"title" | "clientId" | "assigneeIds" | "allocatedHours", string>> = {};
  if (!form.title.trim()) errors.title = "Title is required";
  if (!form.clientId) errors.clientId = "Client is required";
  if (!form.assigneeIds.length) errors.assigneeIds = "At least one assignee is required";
  if (!Number.isFinite(Number.parseFloat(form.allocatedHours)) || Number.parseFloat(form.allocatedHours) <= 0) errors.allocatedHours = "Allocated time must be positive";
  return errors;
}

export function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;

/** The Team Leader of a team (Admin tag row auto-assigns them when the team pill is tapped). */
export function teamLeaderId(data: Pick<DashboardData, "people">, teamId: string): string | null {
  return data.people.find((p) => p.role === "TEAM_LEADER" && p.teamId === teamId)?.id ?? null;
}

/**
 * Admin green-row behaviour: toggling a team pill toggles `teamIds` and, when switching a team ON,
 * adds that team's leader to `assigneeIds` if not already present.
 */
export function toggleTeamWithLeader(
  form: Pick<AddTaskForm, "teamIds" | "assigneeIds">,
  data: Pick<DashboardData, "people">,
  teamId: string,
): Pick<AddTaskForm, "teamIds" | "assigneeIds"> {
  const teamIds = toggleId(form.teamIds, teamId);
  if (!teamIds.includes(teamId)) return { teamIds, assigneeIds: form.assigneeIds };
  const leader = teamLeaderId(data, teamId);
  const assigneeIds = leader && !form.assigneeIds.includes(leader) ? [...form.assigneeIds, leader] : form.assigneeIds;
  return { teamIds, assigneeIds };
}

/** Which validation errors live in the details sheet (title is edited in the main body). */
export function needsDetailsSheet(errors: Partial<Record<"title" | "clientId" | "assigneeIds" | "allocatedHours", string>>): boolean {
  return !!(errors.clientId || errors.assigneeIds || errors.allocatedHours);
}

/** `?add=WORK|MEETING|CHOOSE` → sheet mode (used to deep-link the add sheet). */
export function parseAddParam(value: string | null | undefined): "WORK" | "MEETING" | "CHOOSE" | null {
  return value === "WORK" || value === "MEETING" || value === "CHOOSE" ? value : null;
}
