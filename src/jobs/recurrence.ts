/** Generates the next occurrence for ON_SCHEDULE recurrence rules whose nextRunAt has arrived (SPEC §13). */
import { prisma } from "@/lib/db";
import { spawnNextOccurrence } from "@/server/tasks/recurring";

export async function run(now = new Date()): Promise<{ created: number }> {
  const rules = await prisma.recurrenceRule.findMany({
    where: { stopped: false, trigger: "ON_SCHEDULE", nextRunAt: { lte: now }, tasks: { some: {} } },
    include: { tasks: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } },
  });
  let created = 0;
  for (const r of rules) {
    const latest = r.tasks[0];
    if (!latest) continue;
    const id = await spawnNextOccurrence(latest.id, null);
    if (id) created++;
  }
  return { created };
}
