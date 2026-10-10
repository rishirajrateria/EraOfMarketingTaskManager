import type { Role } from "@prisma/client";

/**
 * Bottom nav row of every signed-in screen (ADR 0016 addendum "nav v3", prototype `#gNav` / `renderDashNav` /
 * `navActive`): Dashboard · Requests · [+] · Notifications · Home, the + exactly centred between two equal groups.
 * Tabs toggle: the open one is highlighted and tapping it again closes it (back home); tapping another one opens that
 * one instead. Home always goes home. Profile lives in the top bar (an avatar that toggles /me). Pure data so tests
 * can check items, the active tab and the toggle targets.
 */
export type NavKey = "DASHBOARD" | "REQUESTS" | "NOTIFICATIONS" | "HOME";
export type NavItem = { key: NavKey; label: string; href: string };
/** Left and right of the centred +. */
export type NavLayout = { left: NavItem[]; right: NavItem[] };

const DASHBOARD: NavItem = { key: "DASHBOARD", label: "Dashboard", href: "/admin/dashboards" };
const NOTIFICATIONS: NavItem = { key: "NOTIFICATIONS", label: "Notifications", href: "/notifications" };
export const PROFILE_HREF = "/me";

/** Where Home and closing a tab land: the task list, or the role's own home for roles without one (HR, parked CA). */
export function navHome(role: Role): string {
  if (role === "HR") return "/attendance";
  if (role === "CA") return "/me";
  return "/dashboard";
}

/**
 * Admin: Dashboard · Requests | + | Notifications · Home. HR keeps the Requests tab its top bar had (the leave inbox):
 * Requests · Notifications | + | Home. Everyone else: Notifications | + | Home.
 */
export function navItems(role: Role): NavLayout {
  const home: NavItem = { key: "HOME", label: "Home", href: navHome(role) };
  if (role === "ADMIN") return { left: [DASHBOARD, { key: "REQUESTS", label: "Requests", href: "/admin/requests" }], right: [NOTIFICATIONS, home] };
  if (role === "HR") return { left: [{ key: "REQUESTS", label: "Requests", href: "/requests/leave" }, NOTIFICATIONS], right: [home] };
  return { left: [NOTIFICATIONS], right: [home] };
}

export const allNavItems = (l: NavLayout): NavItem[] => [...l.left, ...l.right];

/** Roles with the blue + (Task / Meeting, Admin's create shortcuts). HR and CA cannot add tasks (SPEC §2). */
export const canAdd = (role: Role): role is "ADMIN" | "TEAM_LEADER" | "EXECUTIVE" => role === "ADMIN" || role === "TEAM_LEADER" || role === "EXECUTIVE";

/**
 * The +'s Task / Meeting away from the task dashboard: open the dashboard with its add-task sheet up
 * (`AddTaskSheet` reads `?add=`). On the dashboard itself the sheet opens in place (add-task-store).
 */
export const addTaskHref = (mode: "WORK" | "MEETING") => `/dashboard?add=${mode}`;

const pathOf = (href: string) => href.split(/[?#]/)[0];
const clean = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname);
const under = (pathname: string, href: string) => {
  const path = clean(pathname);
  const p = pathOf(href);
  return path === p || path.startsWith(`${p}/`);
};

/** The tab whose screen is open: its path or anything below it (`/admin/requests`, `/admin/requests/…`). */
export function activeNavKey(pathname: string, items: readonly NavItem[]): NavKey | null {
  return items.find((i) => under(pathname, i.href))?.key ?? null;
}

/**
 * The tab drawn as open: none while the add-task screen is up (it covers the page; prototype `navActive`), else the
 * path's. Tapping still follows the path's tab (`navTarget`, Home on the home screen closes what is open there).
 */
export const shownNavKey = (active: NavKey | null, addTaskOpen: boolean): NavKey | null => (addTaskOpen ? null : active);

/** Tapping a tab: the open one closes (→ home), any other one opens; Home always goes home. */
export function navTarget(item: NavItem, active: NavKey | null, role: Role): string {
  return item.key !== "HOME" && item.key === active ? navHome(role) : item.href;
}

/** The top bar's avatar: Profile is open on /me; tapping it again goes home. */
export const profileOpen = (pathname: string) => under(pathname, PROFILE_HREF);
export const profileTarget = (pathname: string, role: Role) => (profileOpen(pathname) ? navHome(role) : PROFILE_HREF);
