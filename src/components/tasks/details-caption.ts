import { addDays } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { DEFAULT_TZ, dateKey } from "@/lib/time";
import type { DashboardData } from "@/server/tasks/types";
import type { DayPlacement } from "@/server/scheduling/day-slot";
import { isDateOnly, type AddTaskForm } from "@/components/tasks/add-task-helpers";
import { fmtStartPill, startMinutes } from "@/components/tasks/meeting-helpers";

/**
 * Caption of the add-task screen's minimised details tray (ADR 0016 addendum, prototype `addTrayTog`): what the
 * collapsed rows hold, in one line. Pure so tests can check it.
 */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-13" → "Tue 13 Oct" (a calendar day: no time zone involved). */
export function fmtDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

/** The server's answer to "next free time on that day" (`previewSlot(…, day)` / `createTask`), Dates or their JSON. */
export type SlotPreview = { start: Date | string; end: Date | string; day?: DayPlacement };

/** Minutes of day of an instant in `tz`, for `fmtStartPill`. */
const minutesOfDay = (d: Date | string, tz: string) => {
  const local = toZonedTime(new Date(d), tz);
  return local.getHours() * 60 + local.getMinutes();
};

/** "Today" / "Tomorrow" / "Tue 13 Oct" for a day key, relative to `now` in `tz`. */
function dayLabelOf(day: string, now: Date, tz: string): string {
  return day === dateKey(now, tz) ? "Today" : day === dateKey(addDays(now, 1), tz) ? "Tomorrow" : fmtDayKey(day);
}

/**
 * The start: "Up next" (none picked: the next free slot), else the day — "Today" / "Tomorrow" / "Tue 13 Oct" in `tz`
 * (the meeting's zone for meetings) — and the time as on the START pills ("11 am"); all-day meetings show the day only.
 * A day with no time reads "Fri 23 Oct - next free 11:30 am" once the server's `preview` for that day is in ("- next
 * free" until then); when that day was full: "Fri 23 Oct full - next free Sat 24 Oct 10 am".
 */
export function whenCaption(form: Pick<AddTaskForm, "type" | "scheduledStart" | "meeting">, now = new Date(), tz = DEFAULT_TZ, preview?: SlotPreview | null): string {
  const value = form.scheduledStart;
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return "Up next";
  const day = value.slice(0, 10);
  const dayLabel = dayLabelOf(day, now, tz);
  const allDay = form.type === "MEETING" && !!form.meeting?.allDay;
  if (allDay) return dayLabel;
  if (isDateOnly(value)) {
    const p = preview?.day?.requestedDay === day ? preview : null;
    if (!p) return `${dayLabel} - next free`;
    const time = fmtStartPill(minutesOfDay(p.start, tz));
    if (p.day?.onRequestedDay) return `${dayLabel} - next free ${time}`;
    return `${dayLabel} ${p.day?.requestedDayOff ? "is a day off" : "full"} - next free ${dayLabelOf(dateKey(new Date(p.start), tz), now, tz)} ${time}`;
  }
  const min = startMinutes(value);
  return min === null ? dayLabel : `${dayLabel} ${fmtStartPill(min)}`;
}

/** "Details · Social + Video · Acme · Today 11 am": the picked teams (task team / invited teams), the client, the start. */
export function detailsCaption(
  form: Pick<AddTaskForm, "type" | "teamIds" | "clientId" | "scheduledStart" | "meeting">,
  data: Pick<DashboardData, "teams" | "clients">,
  now = new Date(),
  tz = DEFAULT_TZ,
  preview?: SlotPreview | null,
): string {
  const teams = form.teamIds.map((id) => data.teams.find((t) => t.id === id)?.name).filter(Boolean).join(" + ");
  const client = form.clientId ? data.clients.find((c) => c.id === form.clientId)?.name : undefined;
  return ["Details", teams, client, whenCaption(form, now, tz, preview)].filter(Boolean).join(" · ");
}

/**
 * Success toast when a date-only start could not be placed on that day (ADR 0010 addendum): "Fri 23 Oct was full -
 * scheduled for Sat 24 Oct 10 am" / "Sun 25 Oct is a day off - scheduled for Mon 26 Oct 10 am". Null when it fit.
 */
export function dayFallbackToast(result: { slot: SlotPreview | null; day?: DayPlacement }, tz = DEFAULT_TZ): string | null {
  const { slot, day } = result;
  if (!slot || !day || day.onRequestedDay) return null;
  const start = new Date(slot.start);
  const why = day.requestedDayOff ? "is a day off" : "was full";
  return `${fmtDayKey(day.requestedDay)} ${why} - scheduled for ${fmtDayKey(dateKey(start, tz))} ${fmtStartPill(minutesOfDay(start, tz))}`;
}
