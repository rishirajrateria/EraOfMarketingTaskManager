import type { Role } from "@prisma/client";
import { env } from "@/lib/env";
import { requireAdminPage } from "@/server/admin/guard";
import { listLeaderOptions, listPeople, listTeamOptions, listWorkTypeOptions } from "@/server/admin/queries";
import { ASSIGNABLE_ROLES } from "@/server/admin/schemas";
import { PeopleManager } from "@/components/admin/PeopleManager";

const ROLES: readonly Role[] = ASSIGNABLE_ROLES;

/** Add Executive / Add Team Leader / HR (SPEC §4, §11.7). CA access is parked (ADR 0004). */
export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ role?: string; edit?: string }> }) {
  const me = await requireAdminPage();
  const { role, edit } = await searchParams;
  const initialRole: Role = ROLES.includes(role as Role) ? (role as Role) : "EXECUTIVE";
  const [users, teams, leaders, workTypes] = await Promise.all([listPeople(), listTeamOptions(), listLeaderOptions(), listWorkTypeOptions()]);
  return <PeopleManager users={users} teams={teams} leaders={leaders} workTypes={workTypes} initialRole={initialRole} workspaceDomain={env.workspaceDomain} meId={me.id} editId={edit ?? null} />;
}
