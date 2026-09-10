"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Role } from "@prisma/client";
import { Avatar } from "@/components/ui/Avatar";
import { MenuTray } from "@/components/shell/MenuTray";
import { useLiveEvents } from "@/components/shell/useLiveEvents";

export type FrameUser = { id: string; name: string; role: Role; image: string | null };

const HOME: Record<Role, string> = {
  ADMIN: "/",
  TEAM_LEADER: "/",
  EXECUTIVE: "/",
  HR: "/attendance",
  CA: "/admin/finance",
};

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [badge, setBadge] = useState(unread);
  const [reqBadge, setReqBadge] = useState(openRequests);
  const pathname = usePathname();
  useEffect(() => setBadge(unread), [unread]);
  useEffect(() => setReqBadge(openRequests), [openRequests]);
  useLiveEvents((e) => {
    if (e.type === "notification" && e.userId === user.id) setBadge((b) => b + 1);
    if (e.type === "requests.changed") setReqBadge((b) => b + 1);
  });

  const title =
    pathname === "/" ? "Tasks" : pathname.split("/").filter(Boolean).slice(-1)[0]?.replace(/-/g, " ") ?? "";
  const requestsHref = user.role === "HR" ? "/requests/leave" : "/requests";

  return (
    <div className="phone-frame">
      <header className="sticky top-0 z-30 flex items-center gap-2 bg-brand-blue-dark px-3 py-2 text-white">
        {user.role === "ADMIN" ? (
          <button className="touch-target -ml-2 text-2xl" onClick={() => setMenuOpen(true)} aria-label="Menu">
            ☰
          </button>
        ) : (
          <Link href={HOME[user.role]} className="touch-target -ml-2 flex items-center text-2xl" aria-label="Home">
            ⌂
          </Link>
        )}
        <Link href={HOME[user.role]} className="flex-1 truncate text-base font-semibold capitalize">
          {title}
        </Link>
        {(user.role === "ADMIN" || user.role === "HR") && (
          <Link href={requestsHref} className="touch-target relative flex items-center text-xl" aria-label="Requests">
            📥
            {reqBadge > 0 ? (
              <span className="absolute -right-1 -top-0.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold">{reqBadge}</span>
            ) : null}
          </Link>
        )}
        <Link href="/notifications" className="touch-target relative flex items-center text-xl" aria-label="Notifications">
          🔔
          {badge > 0 ? (
            <span className="absolute -right-1 -top-0.5 rounded-full bg-red-500 px-1.5 text-[10px] font-bold">{badge}</span>
          ) : null}
        </Link>
        <Link href="/me" aria-label="Profile">
          <Avatar name={user.name} src={user.image} size={30} />
        </Link>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
      {user.role === "ADMIN" ? <MenuTray open={menuOpen} onClose={() => setMenuOpen(false)} /> : null}
    </div>
  );
}
