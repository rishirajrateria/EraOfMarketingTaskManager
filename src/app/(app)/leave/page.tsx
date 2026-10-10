import { requireUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { myLeaves } from "@/server/leave/queries";
import { LeaveScreen } from "@/components/attendance/LeaveScreen";

/** Any active user: request leave and see their own leaves (SPEC §11.5). */
export default async function LeavePage() {
  const user = await requireUser();
  const [settings, leaves] = await Promise.all([getSettings(), myLeaves(user.id)]);
  return <LeaveScreen leaves={leaves} defaultDate={dateKey(new Date(), settings.timezone)} isAdmin={user.role === "ADMIN"} />;
}
