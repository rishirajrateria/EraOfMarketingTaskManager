"use client";
import { usePathname, useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import { ChevronLeft } from "lucide-react";
import { MenuTray } from "@/components/shell/MenuTray";
import { menuStore, useMenuOpen } from "@/components/shell/menu-store";
import { TopBar } from "@/components/shell/TopBar";
import { GlobalNav } from "@/components/shell/GlobalNav";

export type FrameUser = { id: string; name: string; role: Role; image: string | null; email?: string | null };

const HOME: Record<Role, string> = {
  ADMIN: "/",
  TEAM_LEADER: "/",
  EXECUTIVE: "/",
  HR: "/attendance",
  CA: "/me",
};

/** Header titles that differ from the URL segment (ADR 0013: /admin/payments is the Payments & finance hub). */
const TITLES: Record<string, string> = { payments: "Payments & finance", dashboards: "Dashboards" };

/**
 * App shell. Every page except the task dashboard (which draws the bar inside its cyan summary) gets, at the very top,
 * the shared top bar in a cyan band with rounded bottom corners, and right under it the page's own row: back arrow +
 * title (ADR 0016, prototype `pageTop` / `.pgtop`). The ☰ lives in the top bar only. Every page, the task dashboard
 * included, ends with the fixed bottom nav row (GlobalNav, ADR 0016 addendum); `.has-gnav` reserves its height so
 * nothing scrolls under it and the pages' sticky bottom zones sit on top of it.
 */
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
  const pathname = usePathname();
  const router = useRouter();

  // Title = last readable path segment; record ids (cuids) fall back to the parent segment ("invoices", "payments").
  const segments = pathname.split("/").filter(Boolean).filter((s) => !/^c[a-z0-9]{20,}$/i.test(s));
  const last = segments.slice(-1)[0] ?? "";
  const title = pathname === "/" ? "Tasks" : (TITLES[last] ?? last.replace(/-/g, " "));
  const showHeader = pathname !== "/dashboard";
  const back = () => (window.history.length > 1 ? router.back() : router.push(HOME[user.role]));

  return (
    <div className="phone-frame has-gnav">
      {showHeader ? (
        <header className="sticky top-0 z-30 shrink-0">
          <div className="bg-cyan-area relative z-[1] rounded-b-[18px] px-3 pb-1.5 pt-[env(safe-area-inset-top)]">
            <TopBar user={user} />
          </div>
          <div className="-mt-[18px] flex h-[64px] items-center gap-1 border-b border-hair bg-glass px-2 pt-[18px] text-ink backdrop-blur-[22px] backdrop-saturate-[1.8]">
            <button type="button" onClick={back} className="flex h-10 w-9 shrink-0 items-center justify-center rounded-xl hover:bg-chip" aria-label="Back">
              <ChevronLeft size={22} strokeWidth={2.25} />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-[17px] font-bold capitalize tracking-[-.015em]">{title}</h1>
          </div>
        </header>
      ) : null}
      <div className="flex flex-1 flex-col">{children}</div>
      <GlobalNav user={user} unread={unread} openRequests={openRequests} />
      {user.role === "ADMIN" ? <MenuTray open={menuOpen} onClose={() => menuStore.close()} user={{ name: user.name }} /> : null}
    </div>
  );
}
