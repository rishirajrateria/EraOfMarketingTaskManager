import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { requireAdminPage } from "@/server/admin/guard";
import { effective, parseDashParams } from "@/server/dashboards/params";
import { dashRange } from "@/server/dashboards/period";
import { financeDashboard } from "@/server/dashboards/finance";
import { hrDashboard } from "@/server/dashboards/hr";
import { taskDashboard } from "@/server/dashboards/tasks";
import { DashboardsScreen } from "@/components/dashboards/DashboardsScreen";
import { FinanceBody } from "@/components/dashboards/FinanceBody";
import { HrBody } from "@/components/dashboards/HrBody";
import { TaskBody } from "@/components/dashboards/TaskBody";

export const dynamic = "force-dynamic";

/**
 * Admin dashboards (ADR 0016): Finance · HR · Tasks with filters in the URL
 * (?view=FIN|HR|TASK&fin=ALL|INC|EXP&team=&client=&period=MONTH|LAST|QUARTER|FY). Admin only; only the picked view's
 * numbers are computed.
 */
export default async function DashboardsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireAdminPage();
  const raw = parseDashParams(await searchParams);
  const p = effective(raw);
  const now = new Date();
  const tz = (await getSettings()).timezone;
  const range = dashRange(p.period, now, tz);
  const [teams, clients, body] = await Promise.all([
    prisma.team.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.client.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    p.view === "FIN"
      ? financeDashboard(p, now).then((d) => <FinanceBody data={d} />)
      : p.view === "HR"
        ? hrDashboard(p, now).then((d) => <HrBody data={d} />)
        : taskDashboard(p, now).then((d) => <TaskBody data={d} />),
  ]);
  return (
    <DashboardsScreen userId={me.id} params={raw} teams={teams} clients={clients} caption={`${range.label} · ${range.detail}`}>
      {body}
    </DashboardsScreen>
  );
}
