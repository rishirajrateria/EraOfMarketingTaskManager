import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { dashboardData } from "@/server/tasks/queries";
import { Dashboard } from "@/components/dashboard/Dashboard";
import { normaliseFilters } from "@/components/dashboard/filters";

type Search = { task?: string; completed?: string };

/** Task dashboard (SPEC §5) for Admin / Team Leader / Executive. HR and CA have no task dashboard. */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireUser();
  if (user.role === "HR" || user.role === "CA") redirect("/");
  const sp = await searchParams;
  const [data, prefs] = await Promise.all([
    dashboardData(user),
    prisma.user.findUnique({ where: { id: user.id }, select: { filterPrefs: true } }),
  ]);
  return (
    <Dashboard
      data={data}
      filters={normaliseFilters(prefs?.filterPrefs)}
      initialTaskId={sp.task ?? null}
      showCompleted={sp.completed === "1" || sp.completed === "true"}
    />
  );
}
