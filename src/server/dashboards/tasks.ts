import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { actualTone, rowColour, type RowColour } from "@/server/tasks/state";
import { dashRange, type DashRange } from "@/server/dashboards/period";
import type { DashParams } from "@/server/dashboards/params";
import type { Bar } from "@/server/dashboards/finance";

/**
 * Task dashboard (ADR 0016). Open = every live task that is not completed; each is coloured with the same `rowColour`
 * as the cards (started green, late to start red, paused yellow, doubt purple, otherwise not started). Hours count
 * work tasks only (meetings count as tasks, not hours — as on the task dashboard summary, ADR 0015). Completed and
 * "on time" use the WHEN period: completed when approved (else actual end) falls in it; on time = the actual-time
 * pill would be green (`actualTone`, finished on or before the scheduled end).
 */
export type StateKey = "green" | "red" | "yellow" | "purple" | "white";
export const STATE_ORDER: { key: StateKey; label: string }[] = [
  { key: "green", label: "Started" },
  { key: "red", label: "Late to start" },
  { key: "yellow", label: "Paused" },
  { key: "purple", label: "Doubt" },
  { key: "white", label: "Not started" },
];

export type TaskDash = {
  range: DashRange;
  open: number;
  openMinutes: number;
  byState: { key: StateKey; label: string; count: number }[];
  completed: number;
  onTimePct: number | null;
  byTeam: Bar[];
  byClient: Bar[];
};

const hoursSub = (n: number) => `${n} open`;

export async function taskDashboard(p: Pick<DashParams, "team" | "client" | "period">, now = new Date()): Promise<TaskDash> {
  const tz = (await getSettings()).timezone;
  const range = dashRange(p.period, now, tz);
  const where: Prisma.TaskWhereInput = {
    deletedAt: null,
    ...(p.team ? { teams: { some: { teamId: p.team } } } : {}),
    ...(p.client ? { clientId: p.client } : {}),
  };
  const select = {
    id: true, type: true, status: true, doubtRaised: true, allocatedMinutes: true, scheduledStart: true, scheduledEnd: true,
    actualStart: true, actualEnd: true, finishRequestedAt: true, approvedAt: true, clientId: true,
    client: { select: { name: true } }, teams: { select: { team: { select: { id: true, name: true } } } },
  } satisfies Prisma.TaskSelect;
  const [open, done] = await Promise.all([
    prisma.task.findMany({ where: { ...where, status: { not: "COMPLETED" } }, select }),
    prisma.task.findMany({
      where: { ...where, status: "COMPLETED", OR: [{ approvedAt: { gte: range.start, lt: range.end } }, { approvedAt: null, actualEnd: { gte: range.start, lt: range.end } }] },
      select,
    }),
  ]);

  const colour = (t: (typeof open)[number]): StateKey => {
    const c: RowColour = rowColour({ status: t.status, doubtRaised: t.doubtRaised, type: t.type, scheduledStart: t.scheduledStart }, now);
    return c === "grey" ? "white" : c;
  };
  const mins = (t: (typeof open)[number]) => (t.type === "WORK" ? t.allocatedMinutes : 0);
  const counts = new Map<StateKey, number>();
  for (const t of open) counts.set(colour(t), (counts.get(colour(t)) ?? 0) + 1);

  const group = (key: (t: (typeof open)[number]) => { id: string; label: string }[]): Bar[] => {
    const m = new Map<string, Bar & { n: number }>();
    for (const t of open) {
      for (const g of key(t)) {
        const b = m.get(g.id) ?? { id: g.id, label: g.label, value: 0, n: 0 };
        b.value += mins(t);
        b.n++;
        m.set(g.id, b);
      }
    }
    return [...m.values()].sort((a, b) => b.value - a.value || b.n - a.n || a.label.localeCompare(b.label)).map(({ n, ...b }) => ({ ...b, sub: hoursSub(n) }));
  };

  const onTime = done.filter(
    (t) => actualTone({ status: t.status, scheduledStart: t.scheduledStart, scheduledEnd: t.scheduledEnd, actualStart: t.actualStart, actualEnd: t.actualEnd ?? t.approvedAt, finishRequestedAt: t.finishRequestedAt }, now) !== "red",
  ).length;

  return {
    range,
    open: open.length,
    openMinutes: open.reduce((s, t) => s + mins(t), 0),
    byState: STATE_ORDER.map((s) => ({ ...s, count: counts.get(s.key) ?? 0 })),
    completed: done.length,
    onTimePct: done.length ? Math.round((onTime / done.length) * 100) : null,
    byTeam: group((t) => t.teams.map((x) => ({ id: x.team.id, label: x.team.name }))),
    byClient: group((t) => [{ id: t.clientId, label: t.client.name }]),
  };
}
