import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/rbac";
import { leaveInbox } from "@/server/leave/queries";
import { LeaveInbox } from "@/components/attendance/LeaveInbox";

type Search = Promise<{ leaveId?: string }>;

/** HR leave-requests inbox (SPEC §10); Admin can open it too and is the only one who shifts tasks / changes approved leaves. */
export default async function LeaveRequestsPage({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  if (!can.approveLeave(user)) redirect("/");
  const [inbox, sp] = await Promise.all([leaveInbox(), searchParams]);
  return <LeaveInbox inbox={inbox} isAdmin={user.role === "ADMIN"} highlightLeaveId={sp.leaveId} />;
}
