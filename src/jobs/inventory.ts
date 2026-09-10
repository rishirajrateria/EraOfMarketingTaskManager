/**
 * Nightly inventory recalculation (SPEC §1 background jobs, §9.3): snapshots capacity/assigned/sellable
 * per user and per team for today .. +30 days into InventorySnapshot.
 */
import { addDays } from "date-fns";
import { prisma } from "@/lib/db";
import { inventoryFor } from "@/server/inventory/queries";
import { toDbDate } from "@/server/inventory/compute";
import { sumTotals } from "@/server/inventory/compute";

export const SNAPSHOT_DAYS = 30;

export async function run(): Promise<{ snapshots: number }> {
  const from = new Date();
  const to = addDays(from, SNAPSHOT_DAYS);
  const inv = await inventoryFor({ from, to });

  const data: { date: Date; userId: string | null; teamId: string | null; capacityMinutes: number; assignedMinutes: number; sellableMinutes: number }[] = [];
  for (const r of inv.rows) {
    data.push({ date: toDbDate(r.date), userId: r.userId, teamId: null, capacityMinutes: r.capacityMinutes, assignedMinutes: r.assignedMinutes, sellableMinutes: r.sellableMinutes });
  }
  const teamIds = Array.from(new Set(inv.rows.map((r) => r.teamId).filter((t): t is string => !!t)));
  for (const teamId of teamIds) {
    for (const day of inv.days) {
      const t = sumTotals(inv.rows.filter((r) => r.teamId === teamId && r.date === day));
      data.push({ date: toDbDate(day), userId: null, teamId, ...t });
    }
  }

  const first = toDbDate(inv.days[0]);
  const last = toDbDate(inv.days[inv.days.length - 1]);
  await prisma.$transaction([
    prisma.inventorySnapshot.deleteMany({ where: { date: { gte: first, lte: last } } }),
    prisma.inventorySnapshot.createMany({ data }),
  ]);
  return { snapshots: data.length };
}
