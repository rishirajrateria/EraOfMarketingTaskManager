/**
 * Inventory (sellable hours) queries — SPEC §9.3 / §11.6.
 * capacity − assigned = sellable, per person, per team, per day.
 */
import { addDays } from "date-fns";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, zonedEndOfDay, zonedStartOfDay } from "@/lib/time";
import {
  computeCapacityMinutes,
  dayKeysBetween,
  fromDbDate,
  sellable,
  sumTotals,
  toDbDate,
  toWorkingConfig,
  type InventoryRow,
  type InventoryTotals,
} from "@/server/inventory/compute";

export type InventoryRange = { from: Date; to: Date };
export type InventoryOptions = { teamId?: string; userId?: string };

export type UserTotals = InventoryTotals & { userId: string; name: string; teamId: string | null; teamName: string | null };
export type TeamTotals = InventoryTotals & { teamId: string | null; teamName: string };
export type DayTotals = InventoryTotals & { date: string };

export type InventoryResult = {
  days: string[];
  rows: InventoryRow[];
  users: UserTotals[];
  teams: TeamTotals[];
  dayTotals: DayTotals[];
  total: InventoryTotals;
  timezone: string;
};

/** Roles that carry tasks and therefore have sellable capacity. */
const TASK_ROLES = ["ADMIN", "TEAM_LEADER", "EXECUTIVE"] as const;

/** Open WORK tasks count against the day they are scheduled to start; unscheduled ones count on today. */
const OPEN_TASK_WHERE = { deletedAt: null, type: "WORK" as const, status: { not: "COMPLETED" as const } };

export async function inventoryFor(range: InventoryRange, opts: InventoryOptions = {}): Promise<InventoryResult> {
  const settings = await getSettings();
  const cfg = toWorkingConfig(settings);
  const tz = cfg.timezone;
  const days = dayKeysBetween(range.from, range.to, tz);
  const rangeStart = zonedStartOfDay(range.from, tz);
  const rangeEnd = zonedEndOfDay(range.to, tz);
  const todayKey = dateKey(new Date(), tz);

  const users = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: [...TASK_ROLES] },
      ...(opts.teamId ? { teamId: opts.teamId } : {}),
      ...(opts.userId ? { id: opts.userId } : {}),
    },
    select: { id: true, name: true, teamId: true, dailyCapacityMinutes: true, workingDays: true, team: { select: { name: true } } },
    orderBy: [{ teamId: "asc" }, { name: "asc" }],
  });
  const userIds = users.map((u) => u.id);
  const first = toDbDate(days[0]);
  const last = toDbDate(days[days.length - 1]);

  const [attendance, leaves, tasks] = await Promise.all([
    prisma.attendance.findMany({
      where: { userId: { in: userIds }, date: { gte: first, lte: last } },
      select: { userId: true, date: true, status: true },
    }),
    prisma.leave.findMany({
      where: { userId: { in: userIds }, status: { in: ["HR_APPROVED", "ADMIN_APPROVED"] }, from: { lte: last }, to: { gte: first } },
      select: { userId: true, from: true, to: true },
    }),
    prisma.task.findMany({
      where: {
        ...OPEN_TASK_WHERE,
        assignees: { some: { userId: { in: userIds } } },
        OR: [
          { scheduledStart: { gte: rangeStart, lt: rangeEnd } },
          ...(days.includes(todayKey) ? [{ scheduledStart: null }] : []),
        ],
      },
      select: { allocatedMinutes: true, scheduledStart: true, assignees: { select: { userId: true } } },
    }),
  ]);

  const attendanceMap = new Map<string, (typeof attendance)[number]["status"]>();
  for (const a of attendance) attendanceMap.set(`${a.userId}|${fromDbDate(a.date)}`, a.status);

  const leaveDays = new Set<string>();
  for (const l of leaves) {
    let d = toDbDate(fromDbDate(l.from));
    const end = toDbDate(fromDbDate(l.to));
    while (d <= end) {
      leaveDays.add(`${l.userId}|${fromDbDate(d)}`);
      d = addDays(d, 1);
    }
  }

  const assigned = new Map<string, number>();
  const userSet = new Set(userIds);
  for (const t of tasks) {
    const day = t.scheduledStart ? dateKey(t.scheduledStart, tz) : todayKey;
    for (const a of t.assignees) {
      if (!userSet.has(a.userId)) continue;
      const k = `${a.userId}|${day}`;
      assigned.set(k, (assigned.get(k) ?? 0) + t.allocatedMinutes);
    }
  }

  const holidays = new Set(cfg.holidays);
  const rows: InventoryRow[] = [];
  for (const u of users) {
    for (const day of days) {
      const k = `${u.id}|${day}`;
      const capacityMinutes = computeCapacityMinutes({
        date: toDbDate(day),
        user: u,
        settings: cfg,
        attendanceStatus: attendanceMap.get(k) ?? null,
        onLeave: leaveDays.has(k),
        isHoliday: holidays.has(day),
      });
      const assignedMinutes = assigned.get(k) ?? 0;
      rows.push({
        userId: u.id,
        name: u.name,
        teamId: u.teamId,
        date: day,
        capacityMinutes,
        assignedMinutes,
        sellableMinutes: sellable(capacityMinutes, assignedMinutes),
      });
    }
  }

  const userTotals: UserTotals[] = users.map((u) => ({
    userId: u.id,
    name: u.name,
    teamId: u.teamId,
    teamName: u.team?.name ?? null,
    ...sumTotals(rows.filter((r) => r.userId === u.id)),
  }));

  const teamMap = new Map<string | null, { name: string; rows: InventoryRow[] }>();
  for (const u of users) {
    const entry = teamMap.get(u.teamId) ?? { name: u.team?.name ?? "No team", rows: [] };
    entry.rows.push(...rows.filter((r) => r.userId === u.id));
    teamMap.set(u.teamId, entry);
  }
  const teams: TeamTotals[] = Array.from(teamMap.entries()).map(([teamId, e]) => ({ teamId, teamName: e.name, ...sumTotals(e.rows) }));

  const dayTotals: DayTotals[] = days.map((date) => ({ date, ...sumTotals(rows.filter((r) => r.date === date)) }));

  return { days, rows, users: userTotals, teams, dayTotals, total: sumTotals(rows), timezone: tz };
}

/** Next approved leave starting today or later, if any. */
export async function nextApprovedLeave(userId: string) {
  const s = await getSettings();
  const today = toDbDate(dateKey(new Date(), s.timezone));
  return prisma.leave.findFirst({
    where: { userId, status: { in: ["HR_APPROVED", "ADMIN_APPROVED"] }, to: { gte: today } },
    orderBy: { from: "asc" },
  });
}

/**
 * "B4Leave" pill (SPEC §5.1): allocated minutes of the user's open tasks scheduled before their next
 * approved leave. Unscheduled open tasks count (they land on today). Returns 0 when no leave is upcoming.
 */
export async function b4LeaveMinutes(userId: string): Promise<number> {
  const leave = await nextApprovedLeave(userId);
  if (!leave) return 0;
  const s = await getSettings();
  const leaveStart = zonedStartOfDay(leave.from, s.timezone);
  const agg = await prisma.task.aggregate({
    _sum: { allocatedMinutes: true },
    where: {
      ...OPEN_TASK_WHERE,
      assignees: { some: { userId } },
      OR: [{ scheduledStart: null }, { scheduledStart: { lt: leaveStart } }],
    },
  });
  return agg._sum.allocatedMinutes ?? 0;
}
