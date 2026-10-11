import { requireUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { parseFeedFilter } from "@/lib/notification-kinds";
import { parseFeedScope, showsFeedScope } from "@/lib/notification-scope";
import { loadFeed, loadScopeOptions, type ScopeOptions } from "@/server/notification-feed";
import { NotificationFeed } from "@/components/notifications/NotificationFeed";

export const dynamic = "force-dynamic";

/**
 * Notifications (every role, ADR 0017): a feed of what happened — nothing to decide. Decisions are in Requests
 * (Admin `/admin/requests`, HR the leave inbox). `?show=UNREAD|TASKS|PEOPLE|MONEY` filters; Admin / TL / Executive
 * also get TEAMS and CLIENTS rows (`?team=&client=`, prototype `notifTeam` / `notifClient`).
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string; team?: string; client?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = parseFeedFilter(sp.show);
  const [settings, options] = await Promise.all([getSettings(), showsFeedScope(user.role) ? loadScopeOptions(user.id) : Promise.resolve<ScopeOptions | null>(null)]);
  const scope = parseFeedScope(sp, user.role, options ?? undefined);
  const feed = await loadFeed(user, filter, settings.timezone, new Date(), scope);
  const requests = user.role === "ADMIN" ? "/admin/requests" : user.role === "HR" ? "/requests/leave" : null;
  return <NotificationFeed groups={feed.groups} unread={feed.unread} filter={filter} scope={scope} options={options} requests={requests} />;
}
