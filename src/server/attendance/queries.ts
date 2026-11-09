/**
 * Attendance queries (SPEC §11.5): the monthly grid (everyone for HR/Admin, self for others) and CSV.
 */
import { addDays, addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import type { AttendanceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, fmtTime, parseDateKey } from "@/lib/time";
import { fromDbDate, toDbDate, toWorkingConfig } from "@/server/inventory/compute";
import { loadAvailability, loadPeople } from "@/server/availability/load";
import type { DayKind, PersonDay } from "@/server/availability/day-status";
import type { SessionUser } from "@/lib/rbac";

export type GridDay = { key: string; day: number; weekday: number; working: boolean; holiday: boolean };
export type GridCell = {
  /** What the day counts as (ADR 0019 precedence): a leave / holiday wins over the row. */
  status: AttendanceStatus;
  /** The attendance row's own status, if one exists (the marking sheet edits this). */
  marked: AttendanceStatus | null;
  checkIn: string | null;
  checkOut: string | null;
  note: string | null;
  explicit: boolean;
  /** "Marked present on a leave day" etc.: a PRESENT / HALF_DAY row on a day off. */
  warning: string | null;
};
export type GridUser = { id: string; name: string; teamName: string | null };
export type MonthGrid = {
  month: string; // yyyy-MM
  label: string;
  prevMonth: string;
  nextMonth: string;
  days: GridDay[];
  users: GridUser[];
  cells: Record<string, Record<string, GridCell>>;
  timezone: string;
};

export const STATUS_LETTER: Record<AttendanceStatus, string> = { PRESENT: "P", ABSENT: "A", HALF_DAY: "H", LEAVE: "L", HOLIDAY: "HOL" };

export function parseMonth(input: string | undefined, now = new Date(), tz = "Asia/Kolkata"): string {
  if (input && /^\d{4}-(0[1-9]|1[0-2])$/.test(input)) return input;
  return dateKey(now, tz).slice(0, 7);
}

export function monthDayKeys(month: string): string[] {
  const start = startOfMonth(new Date(`${month}-01T00:00:00Z`));
  const end = endOfMonth(start);
  const keys: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) keys.push(format(d, "yyyy-MM-dd"));
  return keys;
}

/** HR/Admin see (and mark) everyone's attendance; everyone else sees only their own month, read-only. */
export const canSeeAllAttendance = (u: SessionUser) => u.role === "ADMIN" || u.role === "HR";
export const canMarkAttendance = canSeeAllAttendance;

/**
 * Monthly grid. Admin/HR see everyone (optionally filtered to one user); others only themselves.
 * Cell precedence is `personDayStatus` (ADR 0019): approved leave > company holiday > weekly off > attendance row.
 * A PRESENT row on a leave / holiday / weekly-off day is kept but flagged with a warning.
 */
export async function attendanceMonth(viewer: SessionUser, input: { month?: string; userId?: string }): Promise<MonthGrid> {
  const s = await getSettings();
  const cfg = toWorkingConfig(s);
  const tz = cfg.timezone;
  const month = parseMonth(input.month, new Date(), tz);
  const keys = monthDayKeys(month);
  const first = toDbDate(keys[0]);
  const last = toDbDate(keys[keys.length - 1]);

  const all = canSeeAllAttendance(viewer);
  const users = await prisma.user.findMany({
    where: all ? { active: true, ...(input.userId ? { id: input.userId } : {}) } : { id: viewer.id },
    select: { id: true, name: true, team: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  const userIds = users.map((u) => u.id);

  const [rows, availability] = await Promise.all([
    prisma.attendance.findMany({ where: { userId: { in: userIds }, date: { gte: first, lte: last } } }),
    loadPeople(userIds).then((people) => loadAvailability(people, keys[0], keys[keys.length - 1], cfg)),
  ]);

  const holidays = new Set(cfg.holidays);
  const days: GridDay[] = keys.map((key) => {
    const d = parseDateKey(key, "UTC");
    const weekday = d.getUTCDay();
    const holiday = holidays.has(key);
    return { key, day: d.getUTCDate(), weekday, working: cfg.workingDays.includes(weekday) && !holiday, holiday };
  });

  const rowOf = new Map(rows.map((r) => [`${r.userId}|${fromDbDate(r.date)}`, r]));
  const cells: Record<string, Record<string, GridCell>> = {};
  for (const id of userIds) {
    cells[id] = {};
    for (const key of keys) {
      const r = rowOf.get(`${id}|${key}`);
      const cell = gridCell(availability.day(id, key), r ? { ...r, checkIn: r.checkIn ? fmtTime(r.checkIn, tz) : null, checkOut: r.checkOut ? fmtTime(r.checkOut, tz) : null } : null);
      if (cell) cells[id][key] = cell;
    }
  }

  const monthDate = new Date(`${month}-01T00:00:00Z`);
  return {
    month,
    label: format(monthDate, "MMMM yyyy"),
    prevMonth: format(addMonths(monthDate, -1), "yyyy-MM"),
    nextMonth: format(addMonths(monthDate, 1), "yyyy-MM"),
    days,
    users: users.map((u) => ({ id: u.id, name: u.name, teamName: u.team?.name ?? null })),
    cells,
    timezone: tz,
  };
}

const OFF_WARNING: Partial<Record<DayKind, string>> = {
  LEAVE: "Marked present on an approved leave day",
  HOLIDAY: "Marked present on a company holiday",
  OFF_WEEKLY: "Marked present on a weekly off",
};

type RowView = { status: AttendanceStatus; checkIn: string | null; checkOut: string | null; note: string | null };

/** One grid cell from the person's day and the row (if any); null = blank. */
export function gridCell(day: PersonDay, row: RowView | null): GridCell | null {
  const warning = day.presentOnOffDay ? (OFF_WARNING[day.kind] ?? null) : null;
  const base = { marked: row?.status ?? null, checkIn: row?.checkIn ?? null, checkOut: row?.checkOut ?? null, note: row?.note ?? null, explicit: !!row, warning };
  if (day.kind === "LEAVE" || day.kind === "HOLIDAY") return { status: day.kind, ...base };
  if (day.kind === "ABSENT") return { status: "ABSENT", ...base };
  if (day.kind === "HALF") return { status: "HALF_DAY", ...base };
  return row ? { status: row.status, ...base } : null; // WORKING / weekly off: the row as marked, else blank
}

/** CSV rows: one line per user per day with a status. */
export function gridToCsv(grid: MonthGrid): string {
  const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const lines = ["user,team,date,status,check_in,check_out,note"];
  for (const u of grid.users) {
    for (const d of grid.days) {
      const c = grid.cells[u.id]?.[d.key];
      if (!c) continue;
      lines.push([esc(u.name), esc(u.teamName), d.key, c.status, esc(c.checkIn), esc(c.checkOut), esc(c.note)].join(","));
    }
  }
  return lines.join("\n") + "\n";
}
