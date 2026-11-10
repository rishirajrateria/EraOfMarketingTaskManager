/**
 * Pure helpers for the Day view's hourly breakdown (SPEC §9.3): one cell per working hour per person,
 * coloured by what is scheduled then. No DB access so it is unit-testable.
 */
import type { WorkingConfig } from "@/lib/working-time";
import type { PersonDay } from "@/server/availability/day-status";

export type HourCellKind = "free" | "assigned" | "lunch" | "off";
export type HourTask = { id: string; title: string; type: "WORK" | "MEETING" };
export type HourCell = { start: number; kind: HourCellKind; tasks: HourTask[] };
/** Minutes-of-day (company timezone) a task occupies on the day, clipped to [0, 1440]. */
export type BusyBlock = { start: number; end: number; task: HourTask };
export type HourlyStatus = "PRESENT" | "HALF_DAY" | "ABSENT" | "LEAVE" | "HOLIDAY" | "OFF" | "AWAY";

export const HOUR = 60;
export const DAY_MINUTES = 24 * HOUR;

/** Start minute of each working hour, e.g. 10:00–19:00 → [600, 660, …, 1080]. */
export function hourStarts(cfg: Pick<WorkingConfig, "workStartMinutes" | "workEndMinutes">): number[] {
  const out: number[] = [];
  for (let m = cfg.workStartMinutes; m < cfg.workEndMinutes; m += HOUR) out.push(m);
  return out;
}

export function minutesLabel(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Clip a task's scheduled window to the day; `dayStart` is the UTC instant of local midnight. */
export function toBusyBlock(
  task: HourTask & { scheduledStart: Date | null; scheduledEnd: Date | null; allocatedMinutes: number },
  dayStart: Date,
): BusyBlock | null {
  if (!task.scheduledStart) return null;
  const start = (task.scheduledStart.getTime() - dayStart.getTime()) / 60_000;
  const endInstant = task.scheduledEnd ?? new Date(task.scheduledStart.getTime() + task.allocatedMinutes * 60_000);
  const end = (endInstant.getTime() - dayStart.getTime()) / 60_000;
  const s = Math.max(0, Math.round(start));
  const e = Math.min(DAY_MINUTES, Math.round(end));
  if (e <= s) return null;
  return { start: s, end: e, task: { id: task.id, title: task.title, type: task.type } };
}

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/** Status of the person's day, for the row label and the "off" colouring — read from `personDayStatus` (ADR 0019). */
export function hourlyStatus(day: Pick<PersonDay, "kind">): HourlyStatus {
  switch (day.kind) {
    case "HALF":
      return "HALF_DAY";
    case "OFF_WEEKLY":
      return "OFF";
    case "WORKING":
      return "PRESENT";
    default:
      return day.kind; // HOLIDAY / LEAVE / ABSENT / AWAY (ADR 0022)
  }
}

/**
 * Cell precedence: off (not at work) > assigned (any open task overlaps the hour) > lunch (hour overlaps
 * the lunch break) > free. `presentFrom`/`presentTo` narrow the at-work window (half days with times).
 */
export function buildHourCells(
  hours: number[],
  cfg: Pick<WorkingConfig, "lunchStartMinutes" | "lunchEndMinutes">,
  busy: BusyBlock[],
  opts: { status: HourlyStatus; presentFrom?: number | null; presentTo?: number | null },
): HourCell[] {
  const dayOff = opts.status === "ABSENT" || opts.status === "LEAVE" || opts.status === "HOLIDAY" || opts.status === "OFF" || opts.status === "AWAY";
  const from = opts.presentFrom ?? 0;
  const to = opts.presentTo ?? DAY_MINUTES;
  return hours.map((start) => {
    const end = start + HOUR;
    if (dayOff || !overlaps(start, end, from, to)) return { start, kind: "off", tasks: [] };
    const tasks = busy.filter((b) => overlaps(start, end, b.start, b.end)).map((b) => b.task);
    if (tasks.length) return { start, kind: "assigned", tasks: dedupe(tasks) };
    if (overlaps(start, end, cfg.lunchStartMinutes, cfg.lunchEndMinutes)) return { start, kind: "lunch", tasks: [] };
    return { start, kind: "free", tasks: [] };
  });
}

function dedupe(tasks: HourTask[]): HourTask[] {
  const seen = new Set<string>();
  return tasks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}
