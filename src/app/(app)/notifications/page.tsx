import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { fmtDateTime } from "@/lib/time";
import { getSettings } from "@/lib/settings";
import { markAllRead } from "@/server/notifications";
import { BottomZone } from "@/components/ui/BottomZone";
import { Screen, ScreenHeader } from "@/components/admin/AdminUi";

export default async function NotificationsPage() {
  const user = await requireUser();
  const [rows, settings] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    getSettings(),
  ]);
  const unread = rows.filter((n) => !n.readAt).length;
  const zone = (
    <BottomZone
      menu={user.role === "ADMIN"}
      right={
        <form
          action={async () => {
            "use server";
            await markAllRead();
          }}
        >
          <button type="submit" className="no-select glass-chip flex h-[22px] items-center whitespace-nowrap rounded-full px-3 text-[11px] leading-none text-[#111]">
            Mark all read
          </button>
        </form>
      }
    />
  );
  return (
    <Screen header={<ScreenHeader title="Notifications" subtitle={`${unread} unread · ${rows.length} shown`} />} zone={zone} className="bg-white/55 backdrop-blur-md">
      {rows.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">Nothing yet.</p> : null}
      <ul className="divide-y divide-white/60">
        {rows.map((n) => (
          <li key={n.id} className={n.readAt ? "" : "bg-blue-100/50"}>
            <Link href={n.href ?? "/"} className="block px-4 py-3">
              <div className="text-sm font-medium">{n.title}</div>
              {n.body ? <div className="text-xs text-gray-600">{n.body}</div> : null}
              <div className="mt-0.5 text-[11px] text-gray-400">{fmtDateTime(n.createdAt, settings.timezone)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
