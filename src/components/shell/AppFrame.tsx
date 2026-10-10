"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Role } from "@prisma/client";
import { Bell, ChevronLeft, Inbox, Menu } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { MenuTray } from "@/components/shell/MenuTray";
import { menuStore, useMenuOpen } from "@/components/shell/menu-store";
import { useLiveEvents } from "@/components/shell/useLiveEvents";

export type FrameUser = { id: string; name: string; role: Role; image: string | null };

const HOME: Record<Role, string> = {
  ADMIN: "/",
  TEAM_LEADER: "/",
  EXECUTIVE: "/",
  HR: "/attendance",
  CA: "/me",
};

/** Header titles that differ from the URL segment (ADR 0013: /admin/payments is the Payments & finance hub). */
const TITLES: Record<string, string> = { payments: "Payments & finance" };

export function AppFrame({
  user,
  unread,
  openRequests,
  children,
}: {
  user: FrameUser;
  unread: number;
  openRequests: number;
  children: React.ReactNode;
}) {
  const menuOpen = useMenuOpen();
  const [badge, setBadge] = useState(unread);
  const [reqBadge, setReqBadge] = useState(openRequests);
  const pathname = usePathname();
  useEffect(() => setBadge(unread), [unread]);
  useEffect(() => setReqBadge(openRequests), [openRequests]);
  useLiveEvents((e) => {
    if (e.type === "notification" && e.userId === user.id) setBadge((b) => b + 1);
    if (e.type === "requests.changed") setReqBadge((b) => b + 1);
  });

  // Title = last readable path segment; record ids (cuids) fall back to the parent segment ("invoices", "payments").
  const segments = pathname.split("/").filter(Boolean).filter((s) => !/^c[a-z0-9]{20,}$/i.test(s));
  const last = segments.slice(-1)[0] ?? "";
  const title = pathname === "/" ? "Tasks" : (TITLES[last] ?? last.replace(/-/g, " "));
  const requestsHref = user.role === "HR" ? "/requests/leave" : "/requests";
  // The dashboard draws its own slim overlay row inside the cyan area (DashboardTopBar) instead of this header.
  const showHeader = pathname !== "/dashboard";

  return (
    <div className="phone-frame">
      {showHeader ? (
        <header className="sticky top-0 z-30 flex min-h-14 items-center gap-1 border-b border-hair bg-glass px-2 pt-[env(safe-area-inset-top)] text-ink backdrop-blur-[22px] backdrop-saturate-[1.8]">
          {user.role === "ADMIN" ? (
            <button className="flex h-10 w-10 items-center justify-center rounded-xl" onClick={() => menuStore.open()} aria-label="Menu">
              <Menu size={18} strokeWidth={2.5} />
            </button>
          ) : (
            <Link href={HOME[user.role]} className="flex h-10 w-10 items-center justify-center rounded-xl" aria-label="Home">
              <ChevronLeft size={22} strokeWidth={2.25} />
            </Link>
          )}
          <Link href={HOME[user.role]} className="flex-1 truncate text-[17px] font-bold capitalize tracking-[-.015em]">
            {title}
          </Link>
          {(user.role === "ADMIN" || user.role === "HR") && (
            <Link href={requestsHref} className="relative flex h-10 w-10 items-center justify-center rounded-xl" aria-label="Requests">
              <Inbox size={18} strokeWidth={2.25} />
              {reqBadge > 0 ? (
                <span className="absolute right-0.5 top-0.5 min-w-[14px] rounded-full bg-red-500 px-1 text-center text-[9px] font-bold leading-[14px] text-white">{reqBadge}</span>
              ) : null}
            </Link>
          )}
          <Link href="/notifications" className="relative flex h-10 w-10 items-center justify-center rounded-xl" aria-label="Notifications">
            <Bell size={18} strokeWidth={2.25} />
            {badge > 0 ? (
              <span className="absolute right-0.5 top-0.5 min-w-[14px] rounded-full bg-red-500 px-1 text-center text-[9px] font-bold leading-[14px] text-white">{badge}</span>
            ) : null}
          </Link>
            <Link href="/me" aria-label="Profile" className="px-1">
              <Avatar name={user.name} src={user.image} size={28} />
            </Link>
        </header>
      ) : null}
      <div className="flex flex-1 flex-col">{children}</div>
      {user.role === "ADMIN" ? <MenuTray open={menuOpen} onClose={() => menuStore.close()} user={{ name: user.name }} /> : null}
    </div>
  );
}
