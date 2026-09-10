import type { Role } from "@prisma/client";
import { env } from "@/lib/env";
import { requireAdminPage } from "@/server/admin/guard";
import { listLeaderOptions, listPeople, listTeamOptions } from "@/server/admin/queries";
import { PeopleManager } from "@/components/admin/PeopleManager";

const ROLES: Role[] = ["ADMIN", "TEAM_LEADER", "EXECUTIVE", "HR", "CA"];

/** Add Executive / Add Team Leader / HR / CA (SPEC §4, §11.7). */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const me = await requireAdminPage();
  const { role } = await searchParams;
  const initialRole: Role = ROLES.includes(role as Role) ? (role as Role) : "EXECUTIVE";
  const [users, teams, leaders] = await Promise.all([listPeople(), listTeamOptions(), listLeaderOptions()]);
  return <PeopleManager users={users} teams={teams} leaders={leaders} initialRole={initialRole} workspaceDomain={env.workspaceDomain} meId={me.id} />;
}
