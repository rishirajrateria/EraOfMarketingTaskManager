"use client";
import Link from "next/link";
import { useCallback, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Bell, House, Inbox, type LucideIcon } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { AddSpeedDial } from "@/components/dashboard/AddSpeedDial";
import { NavRow, navItemCls, navLabCls } from "@/components/dashboard/NavRow";
import { useFabRunner } from "@/components/dashboard/useFabRunner";
import { useLiveBadges } from "@/components/shell/useLiveBadges";
import { addTaskStore, useAddTaskShown, type AddTaskMode } from "@/components/shell/add-task-store";
import { cornerStore } from "@/components/shell/corner-store";
import { activeNavKey, addTaskHref, allNavItems, canAdd, navItems, navTarget, shownNavKey, type NavItem, type NavKey } from "@/components/shell/nav-model";
import type { TopBarUser } from "@/components/shell/TopBar";

const ICONS: Record<NavKey, LucideIcon> = { DASHBOARD: BarChart3, REQUESTS: Inbox, NOTIFICATIONS: Bell, HOME: House };

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

/** A tab: icon over a tiny label, sharing its group's width. Open = blue icon + label on a tinted square, `aria-current`. */
function NavTab({ it, on, href, count, onClick }: { it: NavItem; on: boolean; href: string; count: number; onClick?: (e: React.MouseEvent) => void }) {
  const Icon = ICONS[it.key];
  const aria = count ? `${it.label}, ${count} ${it.key === "REQUESTS" ? "open" : "unread"}` : it.label;
  const title = on && it.key !== "HOME" ? `Close ${it.label.toLowerCase()}` : it.label;
  return (
    <Link href={href} onClick={onClick} aria-label={aria} aria-current={on ? "page" : undefined} title={title} data-nav={it.key} className={clsx(navItemCls, "min-w-0 flex-1 basis-0")}>
      <span aria-hidden className={clsx("flex h-[30px] w-[34px] items-center justify-center rounded-[10px]", on && "bg-[var(--nav-on-bg)] text-[var(--nav-on)]")}>
        <Icon size={20} strokeWidth={on ? 2.3 : 2.1} />
      </span>
      <span aria-hidden className={clsx(navLabCls, "max-w-full truncate tracking-[-0.02em]", on ? "text-[var(--nav-on)]" : "text-muted")}>
        {it.label}
      </span>
      <Badge n={count} tone={it.key === "REQUESTS" ? "red" : "blue"} />
    </Link>
  );
}

/**
 * The bottom nav row of every signed-in screen (ADR 0016 addendum, prototype `#gNav` nav v3): fixed 64px glass (+ the
 * safe-area inset) centred like `.phone-frame` — Dashboard · Requests (red count) | corner | Notifications (count) ·
 * Home, the corner exactly centred between two equal groups. Tabs toggle (nav-model); Home always goes to the task
 * list and, tapped there, closes whatever is open. The corner is the + speed dial for roles that add tasks and the
 * one × while a sheet or closable form page is open (corner-store). Task / Meeting open the dashboard's add-task sheet
 * (in place on the dashboard). The frame reserves the height (`.has-gnav`); sheets stop above the row — the add-task
 * screen too: its × is this centre button (a sub-sheet closes first, then the screen), no tab is highlighted while it
 * is up, and a tab tapped there leaves it for that tab. Profile is the avatar in the top bar.
 */
export function GlobalNav({ user, unread, openRequests }: { user: TopBarUser; unread: number; openRequests: number }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const layout = useMemo(() => navItems(user.role), [user.role]);
  const active = activeNavKey(pathname, allNavItems(layout));
  const shown = shownNavKey(active, useAddTaskShown());
  const badges = useLiveBadges(user.id, unread, openRequests);
  const onAdd = useCallback(
    (mode: AddTaskMode) => {
      if (!addTaskStore.open(mode)) router.push(addTaskHref(mode));
    },
    [router],
  );
  const runFab = useFabRunner(onAdd);
  // Home on the home screen: nothing to navigate to, so close what is open there instead.
  const onHome = (e: React.MouseEvent) => {
    if (active !== "HOME") return;
    e.preventDefault();
    cornerStore.closeAll();
  };
  const tabs = (items: NavItem[]) =>
    items.map((it) => (
      <NavTab
        key={it.key}
        it={it}
        on={it.key === shown}
        href={navTarget(it, active, user.role)}
        count={it.key === "REQUESTS" ? badges.requests : it.key === "NOTIFICATIONS" ? badges.unread : 0}
        onClick={it.key === "HOME" ? onHome : undefined}
      />
    ));
  return (
    <NavRow
      label="Main"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto h-[calc(64px+env(safe-area-inset-bottom))] w-full max-w-[480px] pb-[env(safe-area-inset-bottom)]"
      left={tabs(layout.left)}
      center={<AddSpeedDial role={canAdd(user.role) ? user.role : null} onPick={runFab} />}
      right={tabs(layout.right)}
    />
  );
}
