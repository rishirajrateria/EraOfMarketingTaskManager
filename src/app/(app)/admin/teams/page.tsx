import { requireAdminPage } from "@/server/admin/guard";
import { listLeaderOptions, listTeams } from "@/server/admin/queries";
import { TeamsManager } from "@/components/admin/TeamsManager";

/** Add Team (SPEC §11.8). `?add=1` opens the add form. */
export default async function TeamsPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  await requireAdminPage();
  const [teams, leaders, sp] = await Promise.all([listTeams(), listLeaderOptions(), searchParams]);
  return <TeamsManager teams={teams} leaders={leaders} openAdd={sp.add === "1"} />;
}
