"use client";
import Link from "next/link";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Bell, Inbox, type LucideIcon } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { initials } from "@/components/ui/Avatar";
import { AddSpeedDial } from "@/components/dashboard/AddSpeedDial";
import { navItemCls, navLabCls } from "@/components/dashboard/NavRow";
import { useFabRunner } from "@/components/dashboard/useFabRunner";
import { useLiveBadges } from "@/components/shell/useLiveBadges";
import { addTaskStore, type AddTaskMode } from "@/components/shell/add-task-store";
import { activeNavKey, addTaskHref, canAdd, navItems, navTarget, type NavItem, type NavKey } from "@/components/shell/nav-model";
import type { TopBarUser } from "@/components/shell/TopBar";

const ICONS: Record<Exclude<NavKey, "PROFILE">, LucideIcon> = { DASHBOARD: BarChart3, REQUESTS: Inbox, NOTIFICATIONS: Bell };

function Badge({ n, tone }: { n: number; tone: "red" | "blue" }) {
  if (n <= 0) return null;
  return (
    <span
      aria-hidden
      className={clsx(
        "absolute left-[calc(50%+6px)] top-1 min-w-[16px] rounded-full px-1 text-center text-[9.5px] font-bold leading-4 text-white shadow-[0_0_0_2px_var(--bg)]",
        tone === "red" ? "bg-red-500" : "bg-[var(--n-blue)]",
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** A tab: icon over a tiny label, sharing the width. Open = blue icon + label on a tinted square, `aria-current`. */
function NavTab({ it, on, href, count, user }: { it: NavItem; on: boolean; href: string; count: number; user: TopBarUser }) {
  const Icon = it.key === "PROFILE" ? null : ICONS[it.key];
  const aria = count ? `${it.label}, ${count} ${it.key === "REQUESTS" ? "open" : "unread"}` : it.label;
  return (
    <Link href={href} aria-label={aria} aria-current={on ? "page" : undefined} title={on ? `Close ${it.label.toLowerCase()}` : it.label} data-nav={it.key} className={clsx(navItemCls, "flex-1 basis-0")}>
      <span aria-hidden className={clsx("flex h-[30px] w-[34px] items-center justify-center rounded-[10px]", on && "bg-[var(--nav-on-bg)] text-[var(--nav-on)]")}>
        {Icon ? (
          <Icon size={20} strokeWidth={on ? 2.3 : 2.1} />
        ) : (
          <span
            className={clsx(
              "flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[linear-gradient(150deg,#60a5fa,#2563eb)] text-[10.5px] font-bold text-white",
              on && "shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--nav-on)]",
            )}
          >
            {initials(user.name)}
          </span>
        )}
      </span>
      <span aria-hidden className={clsx(navLabCls, on ? "text-[var(--nav-on)]" : "text-muted")}>
        {it.label}
      </span>
      <Badge n={count} tone={it.key === "REQUESTS" ? "red" : "blue"} />
    </Link>
  );
}

/**
 * The bottom nav row of every signed-in screen (ADR 0016 addendum, prototype `#gNav`): fixed 64px glass (+ the
 * safe-area inset) centred like `.phone-frame` — Dashboard · Requests (red count) · Notifications (count) · Profile
 * as toggling tabs (nav-model), then the corner button: the + speed dial for roles that add tasks, and the one ×
 * while a sheet or closable form page is open (corner-store). Task / Meeting open the dashboard's add-task sheet (in
 * place on the dashboard). The frame reserves the height (`.has-gnav`); sheets stop above the row, only the add-task
 * screen covers it with its own row. Tapping a tab while a sheet is open leaves that page, sheet and all.
 */
export function GlobalNav({ user, unread, openRequests }: { user: TopBarUser; unread: number; openRequests: number }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const items = useMemo(() => navItems(user.role), [user.role]);
  const active = activeNavKey(pathname, items);
  const badges = useLiveBadges(user.id, unread, openRequests);
  const onAdd = useCallback(
    (mode: AddTaskMode) => {
      if (!addTaskStore.open(mode)) router.push(addTaskHref(mode));
    },
    [router],
  );
  const runFab = useFabRunner(onAdd);
  return (
    <nav
      aria-label="Main"
      className="bar-glass fixed inset-x-0 bottom-0 z-30 mx-auto flex h-[calc(64px+env(safe-area-inset-bottom))] w-full max-w-[480px] items-center gap-1.5 border-t border-hair pb-[env(safe-area-inset-bottom)] pl-1.5 pr-2.5"
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {items.map((it) => (
          <NavTab
            key={it.key}
            it={it}
            on={it.key === active}
            href={navTarget(it, active, user.role)}
            count={it.key === "REQUESTS" ? badges.requests : it.key === "NOTIFICATIONS" ? badges.unread : 0}
            user={user}
          />
        ))}
      </div>
      <AddSpeedDial role={canAdd(user.role) ? user.role : null} onPick={runFab} />
    </nav>
  );
}
