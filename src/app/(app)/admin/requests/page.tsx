import { redirect } from "next/navigation";
import { requireUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { requestInbox } from "@/server/requests/inbox";
import { REQUEST_TABS, type RequestTab } from "@/server/dashboards/params";
import { parseFinanceGroup } from "@/server/requests/areas";
import { RequestsInbox } from "@/components/requests/RequestsInbox";

export const dynamic = "force-dynamic";

/**
 * Admin's one requests inbox (ADR 0016): All · Finance · Work · HR (?tab=); Finance narrows with ?fin=APPR|PAY|EXP;
 * ?all=1 also lists handled requests.
 * HR keeps its leave inbox; everyone else goes to their dashboard.
 */
export default async function AdminRequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string; fin?: string; all?: string }> }) {
  const user = await requireUser();
  if (user.role === "HR") redirect("/requests/leave");
  if (user.role !== "ADMIN") redirect("/dashboard");
  const sp = await searchParams;
  const tab: RequestTab = REQUEST_TABS.includes(sp.tab as RequestTab) ? (sp.tab as RequestTab) : "ALL";
  const showAll = sp.all === "1";
  const [inbox, settings] = await Promise.all([requestInbox({ includeResolved: showAll }), getSettings()]);
  return <RequestsInbox inbox={inbox} tab={tab} fin={tab === "FIN" ? parseFinanceGroup(sp.fin) : null} showAll={showAll} tz={settings.timezone} />;
}
