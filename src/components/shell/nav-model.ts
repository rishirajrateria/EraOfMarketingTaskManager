import type { Role } from "@prisma/client";
import { SOFT_HYPHEN } from "@/components/shell/menu-model";

/**
 * Bottom nav row of every signed-in screen (ADR 0016 addendum "nav v4", prototype `#gNav` / `renderDashNav` /
 * `foldersBtn` / `navActive`): Dashboard · Requests · Attendance · [+] · Notifications · Folders · Home, the + exactly
 * centred between two equal groups. Tabs toggle: the open one is highlighted and tapping it again closes it (back
 * home); tapping another one opens that one instead. Home always goes home. Folders is a popover with the two Drive
 * pages (`FOLDER_LINKS`), highlighted on either. Profile lives in the top bar (an avatar that toggles /me). Pure data
 * so tests can check items, the active tab, the toggle targets and the wrapped labels.
 */
export type NavKey = "DASHBOARD" | "REQUESTS" | "ATTENDANCE" | "NOTIFICATIONS" | "FOLDERS" | "HOME";
/** `also`: other screens the tab counts as open on (Folders: the vault / shared links page). */
export type NavItem = { key: NavKey; label: string; href: string; also?: readonly string[] };
/** Left and right of the centred +. */
export type NavLayout = { left: NavItem[]; right: NavItem[] };

const DASHBOARD: NavItem = { key: "DASHBOARD", label: "Dashboard", href: "/admin/dashboards" };
const ATTENDANCE: NavItem = { key: "ATTENDANCE", label: "Attendance", href: "/attendance" };
const NOTIFICATIONS: NavItem = { key: "NOTIFICATIONS", label: "Notifications", href: "/notifications" };
export const PROFILE_HREF = "/me";

/** The Folders tab's popover (prototype `foldersBtn`): icon tone, title, one-line hint and the page it opens. */
export type FolderLink = { key: "DRIVE" | "SHARED"; label: string; hint: string; href: string };
export const FOLDER_LINKS: readonly FolderLink[] = [
  { key: "DRIVE", label: "Drive folders", hint: "Invoices · bills · GST pack", href: "/admin/drive-folders" },
  { key: "SHARED", label: "Shared links", hint: "Folders shared with clients", href: "/admin/vault?tab=SHARED_DRIVE_LINK" },
];
/** Folders opens the monthly Drive folders page first; it is also "on" anywhere in the vault (the shared links live there). */
const FOLDERS: NavItem = { key: "FOLDERS", label: "Folders", href: FOLDER_LINKS[0].href, also: ["/admin/vault"] };

/** Where Home and closing a tab land: the task list, or the role's own home for roles without one (HR, parked CA). */
export function navHome(role: Role): string {
  if (role === "HR") return "/attendance";
  if (role === "CA") return "/me";
  return "/dashboard";
}

/**
 * Admin: Dashboard · Requests · Attendance | + | Notifications · Folders · Home. HR keeps the Requests tab its top bar
 * had (the leave inbox) and its Home IS attendance, so it gets no second Attendance tab: Requests · Notifications | + |
 * Home. Everyone else: Attendance · Notifications | + | Home (the attendance page shows them their own month).
 */
export function navItems(role: Role): NavLayout {
  const home: NavItem = { key: "HOME", label: "Home", href: navHome(role) };
  if (role === "ADMIN") return { left: [DASHBOARD, { key: "REQUESTS", label: "Requests", href: "/admin/requests" }, ATTENDANCE], right: [NOTIFICATIONS, FOLDERS, home] };
  if (role === "HR") return { left: [{ key: "REQUESTS", label: "Requests", href: "/requests/leave" }, NOTIFICATIONS], right: [home] };
  return { left: [ATTENDANCE, NOTIFICATIONS], right: [home] };
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

/** The tab whose screen is open: its path (or one of its `also` paths) or anything below it (`/admin/requests/…`). */
export function activeNavKey(pathname: string, items: readonly NavItem[]): NavKey | null {
  return items.find((i) => [i.href, ...(i.also ?? [])].some((h) => under(pathname, h)))?.key ?? null;
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

/**
 * Tab labels wrap at a natural break (prototype `HYPH` / `hyph`): a soft hyphen the browser only shows when the 9.5px
 * label does not fit its ~47px tab at 360px — "Dash-board", "Re-quests", "Atten-dance", "Notifi-cations". Other words
 * of ten letters or more split in the middle; aria-labels keep the plain word.
 */
export const NAV_HYPH: Readonly<Record<string, string>> = {
  Dashboard: `Dash${SOFT_HYPHEN}board`,
  Attendance: `Atten${SOFT_HYPHEN}dance`,
  Notifications: `Notifi${SOFT_HYPHEN}cations`,
  Requests: `Re${SOFT_HYPHEN}quests`,
};
const splitMid = (w: string) => `${w.slice(0, Math.ceil(w.length / 2))}${SOFT_HYPHEN}${w.slice(Math.ceil(w.length / 2))}`;
export const navLabel = (label: string): string =>
  label
    .split(" ")
    .map((w) => NAV_HYPH[w] ?? (w.length >= 10 ? splitMid(w) : w))
    .join(" ");

/** The top bar's avatar: Profile is open on /me; tapping it again goes home. */
export const profileOpen = (pathname: string) => under(pathname, PROFILE_HREF);
export const profileTarget = (pathname: string, role: Role) => (profileOpen(pathname) ? navHome(role) : PROFILE_HREF);
