/**
 * "<Name> is off that day" (ADR 0019): the people among a task's assignees who are off on its start day, read from
 * `personDayStatus` — the same function the slot finder and inventory use. Not an action (see ./actions.ts).
 */
import { prisma } from "@/lib/db";
import { loadAvailability } from "@/server/availability/load";
import type { AvailabilityConfig, DayKind } from "@/server/availability/day-status";

const OFF: DayKind[] = ["OFF_WEEKLY", "HOLIDAY", "LEAVE", "ABSENT", "AWAY"];

export type OffDayWarning = { userId: string; name: string; kind: DayKind; message: string };

export async function offDayWarningsFor(userIds: string[], key: string, cfg: AvailabilityConfig): Promise<OffDayWarning[]> {
  if (!userIds.length) return [];
  const people = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, dailyCapacityMinutes: true, workingDays: true },
    orderBy: { name: "asc" },
  });
  const availability = await loadAvailability(people, key, key, cfg);
  return people
    .map((p) => ({ p, kind: availability.day(p.id, key).kind }))
    .filter(({ kind }) => OFF.includes(kind))
    .map(({ p, kind }) => ({ userId: p.id, name: p.name, kind, message: `${p.name.trim().split(/\s+/)[0]} is off that day` }));
}
