"use client";
import { Menu } from "lucide-react";
import type { Role } from "@prisma/client";
import { menuStore } from "@/components/shell/menu-store";
import { TopIcons } from "@/components/shell/TopIcons";

export type TopBarUser = { id: string; name: string; image: string | null; email?: string | null; role: Role };

/**
 * The one top bar of every screen (ADR 0016 + addendum, prototype `refreshTop` / `.topbar`): ☰ (Admin) | Gmail ·
 * Drive · WhatsApp. Dashboard · Requests · Notifications · Profile live in the bottom nav row of every screen
 * (GlobalNav), so the top bar no longer repeats them. The task dashboard draws it inside its cyan summary; other
 * pages in a cyan band above their title row.
 */
export function TopBar({ user }: { user: TopBarUser }) {
  return (
    <div className="flex h-9 items-center justify-between gap-1">
      {user.role === "ADMIN" ? (
        <button type="button" aria-label="Menu" onClick={() => menuStore.open()} className="-ml-1.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-z1icon hover:bg-white/15">
          <Menu size={18} strokeWidth={2.5} />
        </button>
      ) : (
        <span />
      )}
      <TopIcons email={user.email} />
    </div>
  );
}
