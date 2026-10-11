import { requireAdminPage } from "@/server/admin/guard";
import { listTeamOptions, listWorkTypes } from "@/server/admin/queries";
import { WorkTypesManager } from "@/components/admin/WorkTypesManager";

/** Add Work (SPEC §11.8). `?add=1` opens the add form. */
export default async function WorkTypesPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  await requireAdminPage();
  const [workTypes, teams, sp] = await Promise.all([listWorkTypes(), listTeamOptions(), searchParams]);
  return <WorkTypesManager workTypes={workTypes} teams={teams} openAdd={sp.add === "1"} />;
}
