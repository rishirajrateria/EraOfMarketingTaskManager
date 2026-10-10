"use client";
import { Menu } from "lucide-react";
import type { Role } from "@prisma/client";
import { menuStore } from "@/components/shell/menu-store";
import { useLiveBadges } from "@/components/shell/useLiveBadges";
import { TopIcons } from "@/components/shell/TopIcons";

export type TopBarUser = { id: string; name: string; image: string | null; email?: string | null; role: Role };

/**
 * The one top bar of every screen (ADR 0016, prototype `refreshTop` / `.topbar`): ☰ (Admin) | Gmail · Drive · WhatsApp |
 * Dashboards (Admin) · Requests (Admin; HR → leave inbox) · Notifications · avatar. Badges follow live events.
 * The task dashboard draws it inside its cyan summary with `appsOnly` — its bottom nav row carries Dashboard ·
 * Requests · Notifications · Profile instead; other pages get the full bar in a cyan band above their title row.
 */
export function TopBar({ user, unread, openRequests, appsOnly = false }: { user: TopBarUser; unread: number; openRequests: number; appsOnly?: boolean }) {
  const badges = useLiveBadges(user.id, unread, openRequests);
  const requestsHref = user.role === "ADMIN" ? "/admin/requests" : user.role === "HR" ? "/requests/leave" : null;
  return (
    <div className="flex h-9 items-center justify-between gap-1">
      {user.role === "ADMIN" ? (
        <button type="button" aria-label="Menu" onClick={() => menuStore.open()} className="-ml-1.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-z1icon hover:bg-white/15">
          <Menu size={18} strokeWidth={2.5} />
        </button>
      ) : (
        <span />
      )}
      <TopIcons user={user} requestsHref={requestsHref} requests={badges.requests} unread={badges.unread} appsOnly={appsOnly} />
    </div>
  );
}
