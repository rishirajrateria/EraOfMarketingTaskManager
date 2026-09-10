import { requireAdminPage } from "@/server/admin/guard";
import { listWorkTypes } from "@/server/admin/queries";
import { WorkTypesManager } from "@/components/admin/WorkTypesManager";

/** Add Work (SPEC §11.8). */
export default async function WorkTypesPage() {
  await requireAdminPage();
  const workTypes = await listWorkTypes();
  return <WorkTypesManager workTypes={workTypes} />;
}
