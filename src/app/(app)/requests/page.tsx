import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";
import { listRequests } from "@/server/requests/queries";
import { RequestsInbox } from "@/components/requests/RequestsInbox";
import { getSettings } from "@/lib/settings";

/** Admin Requests inbox (SPEC §10): finish, doubts, review/time-change, fix-self-task, approved-leave changes. */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const user = await requireUser();
  if (user.role === "HR") redirect("/requests/leave");
  if (user.role !== "ADMIN") redirect("/dashboard");
  const sp = await searchParams;
  const [items, settings] = await Promise.all([listRequests("ADMIN", { includeResolved: sp.all === "1" }), getSettings()]);
  return <RequestsInbox items={items} showAll={sp.all === "1"} tz={settings.timezone} />;
}
