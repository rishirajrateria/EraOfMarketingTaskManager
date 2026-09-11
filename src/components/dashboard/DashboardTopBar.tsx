"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, Inbox, Menu } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { MenuTray } from "@/components/shell/MenuTray";
import { useLiveEvents } from "@/components/shell/useLiveEvents";
import type { DashboardData } from "@/server/tasks/types";

export type TopBarUser = { id: string; name: string; image: string | null; role: DashboardData["role"] };

function Badged({ href, label, count, children }: { href: string; label: string; count: number; children: React.ReactNode }) {
  return (
    <Link href={href} aria-label={label} title={label} className="relative flex h-[26px] w-6 items-center justify-center text-white/70">
      {children}
      {count > 0 ? (
        <span className="absolute -right-1 top-0 min-w-[14px] rounded-full bg-red-500 px-1 text-center text-[9px] font-bold leading-[14px] text-white">{count}</span>
      ) : null}
    </Link>
  );
}

/**
 * Slim 26px overlay row at the top of the cyan area (replaces the app header on /dashboard):
 * ☰ (Admin, opens the MenuTray) · 📥 requests (Admin) · 🔔 notifications · avatar → /me.
 */
export function DashboardTopBar({ user, unread, openRequests }: { user: TopBarUser; unread: number; openRequests: number }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [badge, setBadge] = useState(unread);
  const [reqBadge, setReqBadge] = useState(openRequests);
  useEffect(() => setBadge(unread), [unread]);
  useEffect(() => setReqBadge(openRequests), [openRequests]);
  useLiveEvents((e) => {
    if (e.type === "notification" && e.userId === user.id) setBadge((b) => b + 1);
    if (e.type === "requests.changed") setReqBadge((b) => b + 1);
  });
  const isAdmin = user.role === "ADMIN";
  return (
    <div className="flex h-[26px] items-center justify-between">
      {isAdmin ? (
        <button type="button" aria-label="Menu" onClick={() => setMenuOpen(true)} className="-ml-1 flex h-[26px] w-7 items-center justify-center text-white/70">
          <Menu size={17} strokeWidth={2.5} />
        </button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2.5">
        {isAdmin ? (
          <Badged href="/requests" label="Requests" count={reqBadge}>
            <Inbox size={15} strokeWidth={2.25} />
          </Badged>
        ) : null}
        <Badged href="/notifications" label="Notifications" count={badge}>
          <Bell size={15} strokeWidth={2.25} />
        </Badged>
        <Link href="/me" aria-label="Profile" className="flex items-center opacity-70">
          <Avatar name={user.name} src={user.image} size={22} />
        </Link>
      </div>
      {isAdmin ? <MenuTray open={menuOpen} onClose={() => setMenuOpen(false)} /> : null}
    </div>
  );
}
