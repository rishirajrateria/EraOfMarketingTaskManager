/**
 * Leave from Google Calendar (SPEC §11.5): an employee blocks dates in their calendar (out-of-office or
 * "Leave"/"OOO" titled events) → a leave request is raised here and HR is notified. Runs every 30 minutes.
 */
import { addDays, subDays } from "date-fns";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey, parseDateKey } from "@/lib/time";
import { hrIds, notify } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { bus } from "@/lib/events";
import { listLeaveEvents, type OutOfOfficeEvent } from "@/google/calendar";

/** Calendar event → inclusive local date range (all-day events end on the day after the last day). */
export function eventToRange(e: OutOfOfficeEvent, tz: string): { from: string; to: string } {
  if (e.allDay) {
    const endExclusive = parseDateKey(e.end, "UTC");
    return { from: e.start, to: dateKey(subDays(endExclusive, 1), "UTC") };
  }
  return { from: dateKey(new Date(e.start), tz), to: dateKey(new Date(e.end), tz) };
}

/** Creates leave requests for events not yet known. Idempotent on calendarEventId and on overlapping leaves. */
export async function importLeaveEvents(userId: string, events: OutOfOfficeEvent[], tz: string): Promise<number> {
  let created = 0;
  for (const e of events) {
    const { from, to } = eventToRange(e, tz);
    if (to < from) continue;
    const fromD = parseDateKey(from, "UTC");
    const toD = parseDateKey(to, "UTC");
    const known = await prisma.leave.findFirst({
      where: { userId, OR: [{ calendarEventId: e.id }, { status: { not: "REJECTED" }, from: { lte: toD }, to: { gte: fromD } }] },
      select: { id: true },
    });
    if (known) continue;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const leave = await prisma.$transaction(async (tx) => {
      const l = await tx.leave.create({
        data: { userId, from: fromD, to: toD, reason: `From Google Calendar: ${e.summary}`, calendarEventId: e.id },
      });
      await tx.request.create({ data: { type: "LEAVE", leaveId: l.id, raisedById: userId, targetRole: "HR", note: l.reason } });
      await audit(null, "leave.import_calendar", "Leave", l.id, null, l, tx);
      return l;
    });
    await notify({
      userIds: await hrIds(),
      kind: "LEAVE_REQUESTED",
      title: `Leave requested (calendar) — ${user?.name ?? ""}`,
      body: `${from} → ${to}: ${e.summary}`,
      href: `/requests/leave?leaveId=${leave.id}`,
    });
    bus.publish({ type: "requests.changed" });
    bus.publish({ type: "leave.changed", userId });
    created++;
  }
  return created;
}

export async function run(now = new Date()): Promise<{ users: number; created: number; errors: number }> {
  const settings = await getSettings();
  const users = await prisma.user.findMany({
    where: { active: true, activatedAt: { not: null }, role: { in: ["ADMIN", "TEAM_LEADER", "EXECUTIVE", "HR"] } },
    select: { id: true, email: true },
  });
  let created = 0;
  let errors = 0;
  for (const u of users) {
    try {
      const events = await listLeaveEvents(u.email, now, addDays(now, 60));
      created += await importLeaveEvents(u.id, events, settings.timezone);
    } catch {
      errors++;
    }
  }
  return { users: users.length, created, errors };
}
