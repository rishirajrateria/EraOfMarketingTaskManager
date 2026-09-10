import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { fmtDateTime } from "@/lib/time";
import { getSettings } from "@/lib/settings";
import { markAllRead } from "@/server/notifications";

export default async function NotificationsPage() {
  const user = await requireUser();
  const [rows, settings] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    getSettings(),
  ]);
  return (
    <main className="flex-1 bg-white">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="font-semibold">Notifications</h1>
        <form action={async () => { "use server"; await markAllRead(); }}>
          <button className="text-xs text-brand-blue">Mark all read</button>
        </form>
      </div>
      {rows.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">Nothing yet.</p> : null}
      <ul className="divide-y">
        {rows.map((n) => (
          <li key={n.id} className={n.readAt ? "bg-white" : "bg-blue-50"}>
            <Link href={n.href ?? "/"} className="block px-4 py-3">
              <div className="text-sm font-medium">{n.title}</div>
              {n.body ? <div className="text-xs text-gray-600">{n.body}</div> : null}
              <div className="mt-0.5 text-[11px] text-gray-400">{fmtDateTime(n.createdAt, settings.timezone)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
