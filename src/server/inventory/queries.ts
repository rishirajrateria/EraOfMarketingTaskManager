/**
 * Inventory (sellable hours) queries — SPEC §9.3 / §11.6.
 * capacity − assigned = sellable, per person, per team, per day.
 */
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, zonedEndOfDay, zonedStartOfDay } from "@/lib/time";
import { ACTIVE_STATUSES } from "@/server/tasks/state";
import { BOOKED_TASK_WHERE, loadWorld } from "@/server/availability/booked";
import { loadAvailability, loadPeople } from "@/server/availability/load";
import { buildHourCells, hourStarts, hourlyStatus, toBusyBlock, type BusyBlock, type HourCell, type HourlyStatus } from "@/server/inventory/hourly";
import {
  dayKeysBetween,
  overbooked,
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

/** Booked work (ADR 0019): open work tasks with time, spread over the days they occupy (`availability/booked.ts`). */
const OPEN_TASK_WHERE = BOOKED_TASK_WHERE;

export async function inventoryFor(range: InventoryRange, opts: InventoryOptions = {}): Promise<InventoryResult> {
  const settings = await getSettings();
  const cfg = toWorkingConfig(settings);
  const tz = cfg.timezone;
  const days = dayKeysBetween(range.from, range.to, tz);

  const users = await prisma.user.findMany({
    where: {
      active: true,
      role: { in: [...TASK_ROLES] },
      ...(opts.teamId ? { teamId: opts.teamId } : {}),
      ...(opts.userId ? { id: opts.userId } : {}),
    },
    select: { id: true, name: true, teamId: true, team: { select: { name: true } } },
    orderBy: [{ teamId: "asc" }, { name: "asc" }],
  });
  const world = await loadWorld(users.map((u) => u.id), days[0], days[days.length - 1], cfg);
  const assigned = new Map<string, number>();
  for (const b of world.booked) assigned.set(`${b.userId}|${b.day}`, (assigned.get(`${b.userId}|${b.day}`) ?? 0) + b.minutes);

  const rows: InventoryRow[] = [];
  for (const u of users) {
    for (const day of days) {
      const status = world.availability.day(u.id, day);
      const capacityMinutes = status.capacityMinutes;
      const assignedMinutes = assigned.get(`${u.id}|${day}`) ?? 0;
      rows.push({
        userId: u.id,
        name: u.name,
        teamId: u.teamId,
        date: day,
        kind: status.kind,
        capacityMinutes,
        assignedMinutes,
        sellableMinutes: sellable(capacityMinutes, assignedMinutes),
        overbookedMinutes: overbooked(capacityMinutes, assignedMinutes),
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

export type HourlyRow = UserTotals & { status: HourlyStatus; cells: HourCell[] };
export type HourlyBreakdown = {
  date: string;
  hours: number[];
  lunch: { start: number; end: number };
  rows: HourlyRow[];
  timezone: string;
};

/**
 * Day view (SPEC §9.3): for one day, each person's working hours coloured by what is scheduled then —
 * busy hours come from open tasks' scheduledStart/End, "off" hours from leave / holiday / attendance —
 * plus the person's capacity / assigned / sellable for that day (from `inventoryFor`).
 */
export async function hourlyBreakdown(date: Date, opts: InventoryOptions = {}): Promise<HourlyBreakdown> {
  const settings = await getSettings();
  const cfg = toWorkingConfig(settings);
  const tz = cfg.timezone;
  const key = dateKey(date, tz);
  const dayStart = zonedStartOfDay(date, tz);
  const dayEnd = zonedEndOfDay(date, tz);
  const minutesOfDay = (d: Date) => Math.round((d.getTime() - dayStart.getTime()) / 60_000);

  const inv = await inventoryFor({ from: date, to: date }, opts);
  const userIds = inv.users.map((u) => u.userId);
  const [availability, tasks] = await Promise.all([
    loadPeople(userIds).then((people) => loadAvailability(people, key, key, cfg)),
    prisma.task.findMany({
      where: {
        deletedAt: null,
        deadlineOnly: false,
        status: { in: ACTIVE_STATUSES },
        assignees: { some: { userId: { in: userIds } } },
        scheduledStart: { lt: dayEnd },
        OR: [{ scheduledEnd: { gt: dayStart } }, { scheduledEnd: null, scheduledStart: { gte: dayStart } }],
      },
      select: { id: true, title: true, type: true, scheduledStart: true, scheduledEnd: true, allocatedMinutes: true, assignees: { select: { userId: true } } },
      orderBy: { scheduledStart: "asc" },
    }),
  ]);

  // Meetings are busy time here (an "assigned" hour) though they book no hours in the inventory (ADR 0015/0016).
  const busyByUser = new Map<string, BusyBlock[]>();
  for (const t of tasks) {
    const block = toBusyBlock(t, dayStart);
    if (!block) continue;
    for (const a of t.assignees) busyByUser.set(a.userId, [...(busyByUser.get(a.userId) ?? []), block]);
  }
  const hours = hourStarts(cfg);

  const rows: HourlyRow[] = inv.users.map((u) => {
    const day = availability.day(u.userId, key);
    const status = hourlyStatus(day);
    // Half days and the day someone left early (ADR 0022) only occupy the hours inside the person's window.
    const cut = day.kind === "HALF" || !!day.away;
    const w = cut ? day.window : [];
    const cells = buildHourCells(hours, cfg, busyByUser.get(u.userId) ?? [], {
      status,
      presentFrom: cut ? (w.length ? minutesOfDay(w[0].start) : 0) : null,
      presentTo: cut ? (w.length ? minutesOfDay(w[w.length - 1].end) : 0) : null,
    });
    return { ...u, status, cells };
  });

  return { date: key, hours, lunch: { start: cfg.lunchStartMinutes, end: cfg.lunchEndMinutes }, rows, timezone: tz };
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
