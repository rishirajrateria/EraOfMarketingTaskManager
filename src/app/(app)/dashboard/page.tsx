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
  const [data, prefs, unread, openRequests] = await Promise.all([
    dashboardData(user),
    prisma.user.findUnique({ where: { id: user.id }, select: { filterPrefs: true } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    user.role === "ADMIN" ? prisma.request.count({ where: { status: "OPEN", targetRole: "ADMIN" } }) : Promise.resolve(0),
  ]);
  return (
    <Dashboard
      data={data}
      filters={normaliseFilters(prefs?.filterPrefs)}
      initialTaskId={sp.task ?? null}
      showCompleted={sp.completed === "1" || sp.completed === "true"}
      user={{ id: user.id, name: user.name ?? "", image: user.image ?? null, role: data.role }}
      unread={unread}
      openRequests={openRequests}
    />
  );
}
