import { addDays } from "date-fns";
import { DEFAULT_TZ, dateKey } from "@/lib/time";
import type { DashboardData } from "@/server/tasks/types";
import type { AddTaskForm } from "@/components/tasks/add-task-helpers";
import { fmtStartPill, startMinutes } from "@/components/tasks/meeting-helpers";

/**
 * Caption of the add-task screen's minimised details tray (ADR 0016 addendum, prototype `addTrayTog`): what the
 * collapsed rows hold, in one line. Pure so tests can check it.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-13" → "Tue 13 Oct" (a calendar day: no time zone involved). */
function fmtDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

/**
 * The start: "Up next" (none picked: the next free slot), else the day — "Today" / "Tomorrow" / "Tue 13 Oct" in `tz`
 * (the meeting's zone for meetings) — and the time as on the START pills ("11 am"); all-day meetings show the day only.
 */
export function whenCaption(form: Pick<AddTaskForm, "type" | "scheduledStart" | "meeting">, now = new Date(), tz = DEFAULT_TZ): string {
  const value = form.scheduledStart;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return "Up next";
  const day = value.slice(0, 10);
  const dayLabel = day === dateKey(now, tz) ? "Today" : day === dateKey(addDays(now, 1), tz) ? "Tomorrow" : fmtDayKey(day);
  const min = form.type === "MEETING" && form.meeting?.allDay ? null : startMinutes(value);
  return min === null ? dayLabel : `${dayLabel} ${fmtStartPill(min)}`;
}

/** "Details · Social + Video · Acme · Today 11 am": the picked teams (task team / invited teams), the client, the start. */
export function detailsCaption(
  form: Pick<AddTaskForm, "type" | "teamIds" | "clientId" | "scheduledStart" | "meeting">,
  data: Pick<DashboardData, "teams" | "clients">,
  now = new Date(),
  tz = DEFAULT_TZ,
): string {
  const teams = form.teamIds.map((id) => data.teams.find((t) => t.id === id)?.name).filter(Boolean).join(" + ");
  const client = form.clientId ? data.clients.find((c) => c.id === form.clientId)?.name : undefined;
  return ["Details", teams, client, whenCaption(form, now, tz)].filter(Boolean).join(" · ");
}
