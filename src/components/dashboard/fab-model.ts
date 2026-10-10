import { FileText, KeyRound, Layers, ListTodo, Receipt, Tag, UserRound, UserRoundCheck, type LucideIcon } from "lucide-react";
import type { DashboardData } from "@/server/tasks/types";

/**
 * Dashboard "+" speed dial (ADR 0016 addendum, prototype `fabItems`). Pure data so tests can check order, role
 * filtering and links without rendering. The stack grows upward: the first item sits nearest the thumb.
 */
export type FabTone = "task" | "meet" | "money" | "team" | "client";
export type FabAction =
  | { kind: "add"; mode: "WORK" | "MEETING" }
  | { kind: "href"; href: string }
  /** Client kit: pick the client first (KitPickerSheet). */
  | { kind: "kit" };
/** `icon: null` = the Google Meet glyph. `main` = the two big items (50px). */
export type FabItem = { key: string; label: string; tone: FabTone; icon: LucideIcon | null; main?: boolean; action: FabAction };
/** `main` = Task + Meeting for everyone; `more` = Admin's create shortcuts, shown above a thin separator. */
export type FabMenu = { main: FabItem[]; more: FabItem[] };

const MAIN: FabItem[] = [
  { key: "TASK", label: "Task", tone: "task", icon: ListTodo, main: true, action: { kind: "add", mode: "WORK" } },
  { key: "MEETING", label: "Meeting", tone: "meet", icon: null, main: true, action: { kind: "add", mode: "MEETING" } },
];

/** Same routes as the Admin menu's quick actions and the admin screens' `?add=1` deep links. */
const ADMIN_MORE: FabItem[] = [
  { key: "INVOICE", label: "Invoice", tone: "money", icon: FileText, action: { kind: "href", href: "/admin/invoices?new=1" } },
  { key: "EXPENSE", label: "Expense", tone: "money", icon: Receipt, action: { kind: "href", href: "/admin/expenses/new" } },
  { key: "EXECUTIVE", label: "Executive", tone: "team", icon: UserRound, action: { kind: "href", href: "/admin/people?role=EXECUTIVE&add=1" } },
  { key: "WORK_TYPE", label: "Work type", tone: "team", icon: Tag, action: { kind: "href", href: "/admin/work-types?add=1" } },
  { key: "TEAM", label: "Team", tone: "team", icon: Layers, action: { kind: "href", href: "/admin/teams?add=1" } },
  { key: "TEAM_LEADER", label: "Team leader", tone: "team", icon: UserRoundCheck, action: { kind: "href", href: "/admin/people?role=TEAM_LEADER&add=1" } },
  { key: "KIT", label: "Client kit", tone: "client", icon: KeyRound, action: { kind: "kit" } },
];

/** Team Leaders and Executives get Task + Meeting only; Admin also gets the create shortcuts. */
export function fabMenu(role: DashboardData["role"]): FabMenu {
  return { main: MAIN, more: role === "ADMIN" ? ADMIN_MORE : [] };
}

/** Every item bottom → top (the DOM / focus order). */
export const fabOrder = (m: FabMenu): FabItem[] => [...m.main, ...m.more];

// ---------- "New client kit" picker ----------

export type KitPickerClient = { id: string; name: string; ready: boolean; partial: boolean };

export const NEW_CLIENT_HREF = "/admin/clients?add=1";
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
