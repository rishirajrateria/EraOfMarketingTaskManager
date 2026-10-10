import { FileText, KeyRound, Layers, ListTodo, Receipt, Tag, UserRound, UserRoundCheck, type LucideIcon } from "lucide-react";
import type { DashboardData } from "@/server/tasks/types";

/**
 * Dashboard "+" speed dial and the add-task icon strip (ADR 0016 addendum, prototype `fabItems` / `renderAddNav`).
 * Pure data so tests can check order, role filtering and links without rendering. The speed dial grows upward: the
 * first item sits nearest the thumb.
 */
export type FabTone = "task" | "meet" | "money" | "team" | "client";
export type FabAction =
  | { kind: "add"; mode: "WORK" | "MEETING" }
  | { kind: "href"; href: string }
  /** Client kit: pick the client first (KitPickerSheet). */
  | { kind: "kit" };
/** `icon: null` = the Google Meet glyph. `main` = the two big items (50px). `short` = label in the add-task strip. */
export type FabItem = { key: string; label: string; short: string; tone: FabTone; icon: LucideIcon | null; main?: boolean; action: FabAction };
/** `main` = Task + Meeting for everyone; `more` = Admin's create shortcuts, shown above a thin separator. */
export type FabMenu = { main: FabItem[]; more: FabItem[] };

const MAIN: FabItem[] = [
  { key: "TASK", label: "Task", short: "Task", tone: "task", icon: ListTodo, main: true, action: { kind: "add", mode: "WORK" } },
  { key: "MEETING", label: "Meeting", short: "Meeting", tone: "meet", icon: null, main: true, action: { kind: "add", mode: "MEETING" } },
];

/** `from=add`: closing the opened form (blue ×) or finishing it comes back to the dashboard (useFromAdd). */
export const FROM_ADD_PARAM = "from";
export const FROM_ADD_VALUE = "add";

/** Same routes as the Admin menu's quick actions and the admin screens' `?add=1` deep links, plus `from=add`. */
const ADMIN_MORE: FabItem[] = [
  { key: "INVOICE", label: "Invoice", short: "Invoice", tone: "money", icon: FileText, action: { kind: "href", href: "/admin/invoices?new=1&from=add" } },
  { key: "EXPENSE", label: "Expense", short: "Expense", tone: "money", icon: Receipt, action: { kind: "href", href: "/admin/expenses/new?from=add" } },
  { key: "EXECUTIVE", label: "Executive", short: "Exec", tone: "team", icon: UserRound, action: { kind: "href", href: "/admin/people?role=EXECUTIVE&add=1&from=add" } },
  { key: "WORK_TYPE", label: "Work type", short: "Work", tone: "team", icon: Tag, action: { kind: "href", href: "/admin/work-types?add=1&from=add" } },
  { key: "TEAM", label: "Team", short: "Team", tone: "team", icon: Layers, action: { kind: "href", href: "/admin/teams?add=1&from=add" } },
  { key: "TEAM_LEADER", label: "Team leader", short: "Leader", tone: "team", icon: UserRoundCheck, action: { kind: "href", href: "/admin/people?role=TEAM_LEADER&add=1&from=add" } },
  { key: "KIT", label: "Client kit", short: "Kit", tone: "client", icon: KeyRound, action: { kind: "kit" } },
];

/** Team Leaders and Executives get Task + Meeting only; Admin also gets the create shortcuts. */
export function fabMenu(role: DashboardData["role"]): FabMenu {
  return { main: MAIN, more: role === "ADMIN" ? ADMIN_MORE : [] };
}

/** Every item bottom → top (the DOM / focus order). */
export const fabOrder = (m: FabMenu): FabItem[] => [...m.main, ...m.more];

/** Icon squares — the Admin menu's category colours (money green, team yellow, clients blue); Task blue, Meet white. */
export const FAB_TONE: Record<FabTone, string> = {
  task: "bg-[linear-gradient(150deg,#3b82f6,#1d4ed8)] text-white",
  meet: "border border-[rgba(15,23,42,.14)] bg-white",
  money: "bg-[linear-gradient(150deg,#34d399,#059669)] text-white",
  team: "bg-[linear-gradient(150deg,#fcd34d,#f59e0b)] text-[#3b2a00]",
  client: "bg-[linear-gradient(150deg,#60a5fa,#2563eb)] text-white",
};

// ---------- "New client kit" picker ----------

export type KitPickerClient = { id: string; name: string; ready: boolean; partial: boolean };

export const NEW_CLIENT_HREF = "/admin/clients?add=1&from=add";
/** The client's kit page: Create kit when there is none, Repair when partial, share / send when ready. */
export const kitHref = (clientId: string) => `/admin/client-kit/${encodeURIComponent(clientId)}`;

export function kitHint(c: KitPickerClient): string {
  if (c.ready) return "Kit ready · open it";
  return c.partial ? "Kit incomplete · repair it" : "Create the kit";
}

/** Clients without a (complete) kit first; otherwise keep the incoming (name) order. */
export function sortKitClients<T extends { ready: boolean }>(list: readonly T[]): T[] {
  return [...list.filter((c) => !c.ready), ...list.filter((c) => c.ready)];
}

// ---------- Dashboard bottom nav row ----------

export type DashNavKey = "DASHBOARD" | "REQUESTS" | "NOTIFICATIONS" | "PROFILE";
export type DashNavItem = { key: DashNavKey; label: string; href: string };

/** Prototype `renderDashNav`: Admin gets Dashboard · Requests · Notifications · Profile; everyone else the last two. */
export function dashNavItems(role: DashboardData["role"]): DashNavItem[] {
  const all: DashNavItem[] = [
    { key: "DASHBOARD", label: "Dashboard", href: "/admin/dashboards" },
    { key: "REQUESTS", label: "Requests", href: "/admin/requests" },
    { key: "NOTIFICATIONS", label: "Notifications", href: "/notifications" },
    { key: "PROFILE", label: "Profile", href: "/me" },
  ];
  return role === "ADMIN" ? all : all.filter((i) => i.key === "NOTIFICATIONS" || i.key === "PROFILE");
}
