import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";
import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";

export const DEFAULT_TZ = "Asia/Kolkata";

export function fmtTime(d: Date | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "--:--";
  return formatInTimeZone(d, tz, "h:mma").toLowerCase();
}

export function fmtDate(d: Date | null | undefined, tz = DEFAULT_TZ, pattern = "d MMM"): string {
  if (!d) return "";
  return formatInTimeZone(d, tz, pattern);
}

export function fmtDateTime(d: Date | null | undefined, tz = DEFAULT_TZ): string {
  if (!d) return "";
  return formatInTimeZone(d, tz, "d MMM, h:mma");
}

/** "Today" / "Tomorrow" / "Yestr" / "12 Mar" relative chip (SPEC §5.2). */
export function dateChip(d: Date | null | undefined, now = new Date(), tz = DEFAULT_TZ): string {
  if (!d) return "Unsched";
  const a = startOfDay(toZonedTime(d, tz));
  const b = startOfDay(toZonedTime(now, tz));
  const diff = differenceInCalendarDays(a, b);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tom";
  if (diff === -1) return "Yestr";
  return formatInTimeZone(d, tz, "d MMM");
}

/** Minutes → "4hrs", "1.5hrs", "30m". */
export function fmtMinutes(min: number): string {
  if (!min) return "0m";
  if (min < 60) return `${min}m`;
  const h = min / 60;
  const rounded = Math.round(h * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}hrs`;
}

/** Minutes → "5.5 Hr" for pills. */
export function fmtHoursPill(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} Hr`;
}

/** Local (tz) calendar date of `d` at the given minutes-of-day, returned as UTC instant. */
export function zonedDayAt(d: Date, minutesOfDay: number, tz = DEFAULT_TZ): Date {
  const local = startOfDay(toZonedTime(d, tz));
  local.setMinutes(minutesOfDay);
  return fromZonedTime(local, tz);
}

export function zonedStartOfDay(d: Date, tz = DEFAULT_TZ): Date {
  return fromZonedTime(startOfDay(toZonedTime(d, tz)), tz);
}

export function zonedEndOfDay(d: Date, tz = DEFAULT_TZ): Date {
  return fromZonedTime(addDays(startOfDay(toZonedTime(d, tz)), 1), tz);
}

export function zonedWeekday(d: Date, tz = DEFAULT_TZ): number {
  return toZonedTime(d, tz).getDay();
}

/** yyyy-MM-dd in tz. */
export function dateKey(d: Date, tz = DEFAULT_TZ): string {
  return formatInTimeZone(d, tz, "yyyy-MM-dd");
}

export function parseDateKey(key: string, tz = DEFAULT_TZ): Date {
  return fromZonedTime(`${key}T00:00:00`, tz);
}

export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
