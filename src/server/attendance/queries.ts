/**
 * Attendance queries (SPEC §11.5): today's row for the check-in card and the monthly grid.
 */
import { addDays, addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import type { AttendanceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, fmtTime, parseDateKey } from "@/lib/time";
import { fromDbDate, toDbDate, toWorkingConfig } from "@/server/inventory/compute";
import type { SessionUser } from "@/lib/rbac";

export type GridDay = { key: string; day: number; weekday: number; working: boolean; holiday: boolean };
export type GridCell = { status: AttendanceStatus; checkIn: string | null; checkOut: string | null; note: string | null; explicit: boolean };
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

export const canSeeAllAttendance = (u: SessionUser) => u.role === "ADMIN" || u.role === "HR";

/** Today's attendance row for a user (company timezone). */
export async function todayAttendance(userId: string) {
  const s = await getSettings();
  const key = dateKey(new Date(), s.timezone);
  const row = await prisma.attendance.findUnique({ where: { userId_date: { userId, date: toDbDate(key) } } });
  return { key, row, timezone: s.timezone };
}

/**
 * Monthly grid. Admin/HR see everyone (optionally filtered to one user); others only themselves.
 * Cell precedence: explicit attendance row → approved leave → holiday → (blank).
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

  const [rows, leaves] = await Promise.all([
    prisma.attendance.findMany({ where: { userId: { in: userIds }, date: { gte: first, lte: last } } }),
    prisma.leave.findMany({
      where: { userId: { in: userIds }, status: { in: ["HR_APPROVED", "ADMIN_APPROVED"] }, from: { lte: last }, to: { gte: first } },
      select: { userId: true, from: true, to: true },
    }),
  ]);

  const holidays = new Set(cfg.holidays);
  const days: GridDay[] = keys.map((key) => {
    const d = parseDateKey(key, "UTC");
    const weekday = d.getUTCDay();
    const holiday = holidays.has(key);
    return { key, day: d.getUTCDate(), weekday, working: cfg.workingDays.includes(weekday) && !holiday, holiday };
  });

  const cells: Record<string, Record<string, GridCell>> = {};
  for (const id of userIds) cells[id] = {};
  for (const l of leaves) {
    for (let d = toDbDate(fromDbDate(l.from)); d <= toDbDate(fromDbDate(l.to)); d = addDays(d, 1)) {
      const k = fromDbDate(d);
      if (k >= keys[0] && k <= keys[keys.length - 1]) cells[l.userId][k] = { status: "LEAVE", checkIn: null, checkOut: null, note: null, explicit: false };
    }
  }
  for (const id of userIds) {
    for (const key of keys) if (holidays.has(key) && !cells[id][key]) cells[id][key] = { status: "HOLIDAY", checkIn: null, checkOut: null, note: null, explicit: false };
  }
  for (const r of rows) {
    cells[r.userId][fromDbDate(r.date)] = {
      status: r.status,
      checkIn: r.checkIn ? fmtTime(r.checkIn, tz) : null,
      checkOut: r.checkOut ? fmtTime(r.checkOut, tz) : null,
      note: r.note,
      explicit: true,
    };
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
