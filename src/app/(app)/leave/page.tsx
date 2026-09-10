import { requireUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { myLeaves } from "@/server/leave/queries";
import { LeaveForm } from "@/components/attendance/LeaveForm";
import { LeaveList } from "@/components/attendance/LeaveList";

/** Any active user: request leave and see their own leaves (SPEC §11.5). */
export default async function LeavePage() {
  const user = await requireUser();
  const [settings, leaves] = await Promise.all([getSettings(), myLeaves(user.id)]);
  return (
    <div className="pb-6">
      <LeaveForm defaultDate={dateKey(new Date(), settings.timezone)} />
      <h2 className="mx-4 mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">My leaves</h2>
      <LeaveList leaves={leaves} />
    </div>
  );
}
