import { FileText, KeyRound, Layers, ListTodo, Receipt, Tag, UserRound, UserRoundCheck, type LucideIcon } from "lucide-react";
import type { DashboardData } from "@/server/tasks/types";
import { FROM_ADD_PARAM, FROM_ADD_VALUE, LIST_FLOWS, listFlowHref, type ListFlowKey } from "@/components/shell/list-flow";

/**
 * The "+" speed dial (bottom nav of every screen) and the add-task icon strip (ADR 0016 addendum, prototype
 * `fabItems` / `renderAddNav`). Pure data so tests can check order, role filtering and links without rendering. The
 * speed dial grows upward: the first item sits nearest the thumb.
 */
export type FabTone = "task" | "meet" | "money" | "team" | "client";
export type FabAction = { kind: "add"; mode: "WORK" | "MEETING" } | { kind: "href"; href: string };
/** The eye left of a list item's label: its list page with the add form minimised (`label` = aria-label). */
export type FabView = { href: string; label: string };
/**
 * `icon: null` = the Google Meet glyph. `main` = the two big items (50px). `short` = label in the add-task strip.
 * `view` = the eye (list items only); `action` of a list item = the same page with the add form expanded.
 */
export type FabItem = { key: string; label: string; short: string; tone: FabTone; icon: LucideIcon | null; main?: boolean; action: FabAction; view?: FabView };
/** `main` = Task + Meeting for everyone; `more` = Admin's create shortcuts, shown above a thin separator. */
export type FabMenu = { main: FabItem[]; more: FabItem[] };

const MAIN: FabItem[] = [
  { key: "TASK", label: "Task", short: "Task", tone: "task", icon: ListTodo, main: true, action: { kind: "add", mode: "WORK" } },
  { key: "MEETING", label: "Meeting", short: "Meeting", tone: "meet", icon: null, main: true, action: { kind: "add", mode: "MEETING" } },
];

const fromAdd = `${FROM_ADD_PARAM}=${FROM_ADD_VALUE}`;

/** A list page + its add form: the item opens it expanded (`?add=1`), the eye minimised (`?add=min`). */
function listItem(key: ListFlowKey, label: string, short: string, tone: FabTone, icon: LucideIcon): FabItem {
  const flow = LIST_FLOWS[key];
  return { key, label, short, tone, icon, action: { kind: "href", href: listFlowHref(flow.base, "open") }, view: { href: listFlowHref(flow.base, "min"), label: flow.view } };
}

/** Invoice / Expense open their create screens (`from=add`: the × returns to the dashboard); the rest are list flows. */
const ADMIN_MORE: FabItem[] = [
  { key: "INVOICE", label: "Invoice", short: "Invoice", tone: "money", icon: FileText, action: { kind: "href", href: `/admin/invoices?new=1&${fromAdd}` } },
  { key: "EXPENSE", label: "Expense", short: "Expense", tone: "money", icon: Receipt, action: { kind: "href", href: `/admin/expenses/new?${fromAdd}` } },
  listItem("EXECUTIVE", "Executive", "Exec", "team", UserRound),
  listItem("WORK_TYPE", "Work type", "Work", "team", Tag),
  listItem("TEAM", "Team", "Team", "team", Layers),
  listItem("TEAM_LEADER", "Team leader", "Leader", "team", UserRoundCheck),
  listItem("KIT", "Client kit", "Kit", "client", KeyRound),
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

export const NEW_CLIENT_HREF = `/admin/clients?add=1&${fromAdd}`;
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
