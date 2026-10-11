import { requireAdminPage } from "@/server/admin/guard";
import { getSettingsDto, googleIntegrationStatus } from "@/server/admin/queries";
import { SettingsForm } from "@/components/admin/SettingsForm";

export const dynamic = "force-dynamic";

/** Settings (SPEC §11.9). */
export default async function SettingsPage() {
  await requireAdminPage();
  const settings = await getSettingsDto();
  return <SettingsForm key={settings.updatedAt} settings={settings} google={googleIntegrationStatus()} />;
}
