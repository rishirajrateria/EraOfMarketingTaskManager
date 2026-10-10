import type { Role } from "@prisma/client";

/**
 * Bottom nav row on every signed-in screen (ADR 0016 addendum, prototype `#gNav` / `renderDashNav` / `navActive`):
 * Dashboard · Requests · Notifications · Profile, then the blue + (roles that can add tasks). The items are tabs that
 * toggle: the open one is highlighted and tapping it again closes it (back to the role's home); tapping another one
 * opens that one instead. Pure data so tests can check items, the active tab and the toggle targets.
 */
export type NavKey = "DASHBOARD" | "REQUESTS" | "NOTIFICATIONS" | "PROFILE";
export type NavItem = { key: NavKey; label: string; href: string };

const DASHBOARD: NavItem = { key: "DASHBOARD", label: "Dashboard", href: "/admin/dashboards" };
const NOTIFICATIONS: NavItem = { key: "NOTIFICATIONS", label: "Notifications", href: "/notifications" };
const PROFILE: NavItem = { key: "PROFILE", label: "Profile", href: "/me" };

/**
 * Admin: all four. HR keeps the Requests tab its top bar had (the leave inbox); everyone else gets Notifications and
 * Profile only (as on the task dashboard before).
 */
export function navItems(role: Role): NavItem[] {
  if (role === "ADMIN") return [DASHBOARD, { key: "REQUESTS", label: "Requests", href: "/admin/requests" }, NOTIFICATIONS, PROFILE];
  if (role === "HR") return [{ key: "REQUESTS", label: "Requests", href: "/requests/leave" }, NOTIFICATIONS, PROFILE];
  return [NOTIFICATIONS, PROFILE];
}

/** Where closing a tab lands: the task dashboard, or the role's own home for roles without one (HR, parked CA). */
export function navHome(role: Role): string {
  if (role === "HR") return "/attendance";
  if (role === "CA") return "/me";
  return "/dashboard";
}

/** Roles with the blue + (Task / Meeting, Admin's create shortcuts). HR and CA cannot add tasks (SPEC §2). */
export const canAdd = (role: Role): role is "ADMIN" | "TEAM_LEADER" | "EXECUTIVE" => role === "ADMIN" || role === "TEAM_LEADER" || role === "EXECUTIVE";

/**
 * The +'s Task / Meeting away from the task dashboard: open the dashboard with its add-task sheet up
 * (`AddTaskSheet` reads `?add=`). On the dashboard itself the sheet opens in place (add-task-store).
 */
export const addTaskHref = (mode: "WORK" | "MEETING") => `/dashboard?add=${mode}`;

const pathOf = (href: string) => href.split(/[?#]/)[0];

/** The tab whose screen is open: its path or anything below it (`/admin/requests`, `/admin/requests/…`). */
export function activeNavKey(pathname: string, items: readonly NavItem[]): NavKey | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const hit = items.find((i) => {
    const p = pathOf(i.href);
    return path === p || path.startsWith(`${p}/`);
  });
  return hit?.key ?? null;
}

/** Tapping a tab: the open one closes (→ home), any other one opens. */
export function navTarget(item: NavItem, active: NavKey | null, role: Role): string {
  return item.key === active ? navHome(role) : item.href;
}
