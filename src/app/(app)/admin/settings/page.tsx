import { requireAdminPage } from "@/server/admin/guard";
import { getSettingsDto, googleIntegrationStatus } from "@/server/admin/queries";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { FailedJobsSection } from "@/components/admin/FailedJobsSection";
import { listFailedJobs } from "@/google/job-failure";

export const dynamic = "force-dynamic";

/** Settings (SPEC §11.9). */
export default async function SettingsPage() {
  await requireAdminPage();
  const [settings, failedJobs] = await Promise.all([getSettingsDto(), listFailedJobs()]);
  return <SettingsForm key={settings.updatedAt} settings={settings} google={googleIntegrationStatus()} extra={<FailedJobsSection jobs={failedJobs} />} />;
}
