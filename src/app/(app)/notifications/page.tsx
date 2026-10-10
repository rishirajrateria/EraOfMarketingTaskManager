import { requireUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { parseFeedFilter } from "@/lib/notification-kinds";
import { loadFeed } from "@/server/notification-feed";
import { NotificationFeed, type FeedLinks } from "@/components/notifications/NotificationFeed";

export const dynamic = "force-dynamic";

/**
 * Notifications (every role, ADR 0017): a feed of what happened — nothing to decide. Decisions are in Requests
 * (Admin `/admin/requests`, HR the leave inbox). `?show=UNREAD|TASKS|PEOPLE|MONEY` filters.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser();
  const filter = parseFeedFilter((await searchParams).show);
  const settings = await getSettings();
  const feed = await loadFeed(user, filter, settings.timezone);
  const links: FeedLinks = {
    requests: user.role === "ADMIN" ? "/admin/requests" : user.role === "HR" ? "/requests/leave" : null,
    home: user.role === "HR" ? { href: "/requests/leave", label: "Leave inbox" } : user.role === "CA" ? { href: "/me", label: "Profile" } : { href: "/dashboard", label: "Task list" },
  };
  return <NotificationFeed groups={feed.groups} unread={feed.unread} filter={filter} links={links} />;
}
