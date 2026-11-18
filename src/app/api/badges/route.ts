import { currentUser } from "@/lib/rbac";
import { unreadNotificationCount } from "@/server/notification-feed";
import { requestBadgeCount } from "@/server/requests/inbox";

export const dynamic = "force-dynamic";

/** The true header badge counts (bell + Requests). The client re-fetches this on `requests.changed` instead of guessing (B3). */
export async function GET() {
  const user = await currentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const [unread, requests] = await Promise.all([unreadNotificationCount(user.id), requestBadgeCount(user.role)]);
  return Response.json({ unread, requests }, { headers: { "Cache-Control": "no-store" } });
}
