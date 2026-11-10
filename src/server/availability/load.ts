/**
 * Loads what `personDayStatus` needs (approved leave, attendance rows) for a set of people and a range of day keys,
 * and answers "what is this person's day" through the ONE function (ADR 0019). Every screen and the slot finder go
 * through `Availability.day`, so a day can never read differently in two places.
 */
import { prisma } from "@/lib/db";
import { addKeyDays, personDayStatus, type AttendanceMark, type AvailabilityConfig, type AvailabilityUser, type AwayMark, type PersonDay } from "@/server/availability/day-status";
import { fromDbDate, toDbDate } from "@/server/inventory/compute";

export const APPROVED_LEAVE_STATUSES = ["HR_APPROVED", "ADMIN_APPROVED"] as const;

export type AvailabilityPerson = AvailabilityUser & { id: string };

/** Inclusive yyyy-MM-dd keys of an approved leave (`@db.Date` columns are read with `fromDbDate`, never a zone). */
export function leaveKeys(leave: { from: Date; to: Date }, clip?: { from: string; to: string }): string[] {
  const out: string[] = [];
  const last = fromDbDate(leave.to);
  let k = fromDbDate(leave.from);
  if (clip && k < clip.from) k = clip.from;
  for (let i = 0; i < 4000 && k <= last && (!clip || k <= clip.to); i++) {
    out.push(k);
    k = addKeyDays(k, 1);
  }
  return out;
}

export class Availability {
  private readonly memo = new Map<string, PersonDay>();

  constructor(
    readonly cfg: AvailabilityConfig,
    private readonly people: Map<string, AvailabilityPerson>,
    private readonly rows: Map<string, AttendanceMark>,
    private readonly leave: Set<string>,
    /** `${userId}|${dayKey}` → the early leave covering that day (ADR 0022). */
    private readonly away: Map<string, AwayMark> = new Map(),
  ) {}

  has(userId: string): boolean {
    return this.people.has(userId);
  }

  /** The person's status, window and capacity on `dayKey` (company time zone). */
  day(userId: string, dayKey: string): PersonDay {
    const id = `${userId}|${dayKey}`;
    let d = this.memo.get(id);
    if (!d) {
      const user = this.people.get(userId) ?? { dailyCapacityMinutes: null, workingDays: [] };
      d = personDayStatus({ user, dayKey, cfg: this.cfg, onLeave: this.leave.has(id), attendance: this.rows.get(id) ?? null, away: this.away.get(id) ?? null });
      this.memo.set(id, d);
    }
    return d;
  }
}

/** Loads leave + attendance for `people` over [fromKey, toKey] (company-zone day keys). */
export async function loadAvailability(people: AvailabilityPerson[], fromKey: string, toKey: string, cfg: AvailabilityConfig): Promise<Availability> {
  const ids = people.map((p) => p.id);
  const [attendance, leaves, early] = ids.length
    ? await Promise.all([
        prisma.attendance.findMany({
          where: { userId: { in: ids }, date: { gte: toDbDate(fromKey), lte: toDbDate(toKey) } },
          select: { userId: true, date: true, status: true, checkIn: true, checkOut: true },
        }),
        prisma.leave.findMany({
          where: { userId: { in: ids }, status: { in: [...APPROVED_LEAVE_STATUSES] }, from: { lte: toDbDate(toKey) }, to: { gte: toDbDate(fromKey) } },
          select: { userId: true, from: true, to: true },
        }),
        prisma.earlyLeave.findMany({
          where: { userId: { in: ids }, active: true, day: { lte: toDbDate(toKey) }, coveredThrough: { gte: toDbDate(fromKey) } },
          select: { id: true, userId: true, day: true, leftAt: true, reason: true, coveredThrough: true },
          orderBy: { createdAt: "asc" },
        }),
      ])
    : [[], [], []];
  const rows = new Map<string, AttendanceMark>();
  for (const a of attendance) rows.set(`${a.userId}|${fromDbDate(a.date)}`, { status: a.status, checkIn: a.checkIn, checkOut: a.checkOut });
  const leave = new Set<string>();
  for (const l of leaves) for (const k of leaveKeys(l, { from: fromKey, to: toKey })) leave.add(`${l.userId}|${k}`);
  return new Availability(cfg, new Map(people.map((p) => [p.id, p])), rows, leave, awayMarks(early, { from: fromKey, to: toKey }));
}

/**
 * `${userId}|${dayKey}` → the early leave covering it (ADR 0022): the leaving day carries `leftAt`, every later covered
 * day (through `coveredThrough`) none. A later record wins over an earlier one on the same day.
 */
export function awayMarks(
  rows: { id: string; userId: string; day: Date; leftAt: Date; reason: string; coveredThrough: Date }[],
  clip?: { from: string; to: string },
): Map<string, AwayMark> {
  const out = new Map<string, AwayMark>();
  for (const r of rows) {
    const first = fromDbDate(r.day);
    for (const k of leaveKeys({ from: r.day, to: r.coveredThrough }, clip)) {
      out.set(`${r.userId}|${k}`, { leftAt: k === first ? r.leftAt : null, reason: r.reason, earlyLeaveId: r.id });
    }
  }
  return out;
}

/** The people (capacity override + own working days) for `userIds`. */
export async function loadPeople(userIds: string[]): Promise<AvailabilityPerson[]> {
  if (!userIds.length) return [];
  return prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, dailyCapacityMinutes: true, workingDays: true } });
}
