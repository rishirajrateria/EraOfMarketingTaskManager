"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { LogOut, Settings } from "lucide-react";
import type { Role } from "@prisma/client";
import { clsx } from "@/lib/clsx";
import { TopIcons } from "@/components/shell/TopIcons";
import { SignOutSheet } from "@/components/shell/SignOutSheet";
import { SETTINGS_HREF, settingsOpen, showsSettings } from "@/components/shell/nav-model";

export type TopBarUser = { id: string; name: string; image: string | null; email?: string | null; role: Role };

/**
 * The one top bar of every screen (ADR 0016 + addendum nav v3, prototype `refreshTop` / `.topbar`): Settings (Admin) ·
 * Sign out on the left where the ☰ was (prototype `settingsBtn` / `signoutBtn`; the menu tray is gone) | Gmail · Drive
 * · WhatsApp | Profile (avatar toggle, TopIcons) on the right. Dashboard · Requests · Notifications · Home live in the
 * bottom nav row of every screen (GlobalNav). The task dashboard draws it inside its cyan summary; other pages in a
 * cyan band above their title row.
 */
const ico =
  "flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-z1icon outline-none transition-colors hover:bg-white/15 focus-visible:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/80";

export function TopBar({ user }: { user: TopBarUser }) {
  const pathname = usePathname() ?? "/";
  const [signingOut, setSigningOut] = useState(false);
  const onSettings = settingsOpen(pathname);
  return (
    <div className="flex h-9 items-center justify-between gap-1">
      <div className="-ml-1.5 flex shrink-0 items-center gap-[2px]">
        {showsSettings(user.role) ? (
          <Link href={SETTINGS_HREF} aria-label="Settings" title="Settings" aria-current={onSettings ? "page" : undefined} data-settings className={clsx(ico, onSettings && "bg-white/20")}>
            <Settings size={18} strokeWidth={2.25} />
          </Link>
        ) : null}
        <button type="button" aria-label="Sign out" title="Sign out" aria-haspopup="dialog" onClick={() => setSigningOut(true)} data-signout className={ico}>
          <LogOut size={18} strokeWidth={2.25} />
        </button>
      </div>
      <TopIcons user={user} />
      <SignOutSheet open={signingOut} onClose={() => setSigningOut(false)} />
    </div>
  );
}
