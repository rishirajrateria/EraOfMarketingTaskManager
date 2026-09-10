import { requireAdminPage } from "@/server/admin/guard";
import { listLeaderOptions, listTeams } from "@/server/admin/queries";
import { TeamsManager } from "@/components/admin/TeamsManager";

/** Add Designation (SPEC §11.8). */
export default async function TeamsPage() {
  await requireAdminPage();
  const [teams, leaders] = await Promise.all([listTeams(), listLeaderOptions()]);
  return <TeamsManager teams={teams} leaders={leaders} />;
}
