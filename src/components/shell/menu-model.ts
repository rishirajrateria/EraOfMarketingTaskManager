import {
  BarChart3, Bell, Building2, CalendarCheck, Clock, FileText, Folder, FolderKey, HardDrive, Inbox, Layers, ListChecks, LogOut,
  Receipt, Settings, Tag, UserCheck, UserRoundCheck, Users, type LucideIcon,
} from "lucide-react";
import type { MenuCounts } from "@/server/shell/menu";
import { inrShort } from "@/components/dashboards/format";

/**
 * Admin menu model (ADR 0011 v3 tiles, ADR 0016 dashboards). Pure data so tests can check groups, order, labels,
 * badges and links without rendering. Colour = category: Money green, Clients blue, Team yellow, Other purple.
 */
export type Tone = "money" | "client" | "team" | "other" | "red";
export type BadgeTone = "red" | "amber" | "soft";
export type Badge = { n: number; tone: BadgeTone } | null;
/** `sub` is the old one-line status: on a tile it becomes the title / aria-label and is still searched. */
export type MenuItem = { href: string; icon: LucideIcon; label: string; sub?: string; badge?: Badge; danger?: boolean };
export type MenuSection = { title: string; tone: Tone; items: MenuItem[] };
export type QuickAction = { label: string; icon: LucideIcon; tone: Tone; href: string };

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const badge = (n: number, tone: BadgeTone): Badge => (n > 0 ? { n, tone } : null);

export function financeSub(c: MenuCounts | null): string {
  if (!c) return "Income, expense, invoices, bills";
  // compact rupees next to an approval count so the line stays short
  const owed = c.invoicesToApprove ? inrShort(c.outstanding) : inr(c.outstanding);
  const parts = [c.invoicesToApprove ? `${c.invoicesToApprove} to approve` : "", c.outstanding ? `${owed} outstanding` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Income, expense, invoices, bills";
}

export function hrSub(c: MenuCounts | null): string {
  if (!c || !c.attendanceMarkedToday) return "Attendance, inventory, leave";
  return `${c.presentToday} present · ${c.onLeaveToday} on leave today`;
}

export function taskSub(c: MenuCounts | null): string {
  if (!c) return "Open tasks, hours, on time";
  return `${c.tasksOpen} open${c.tasksLate ? ` · ${c.tasksLate} late to start` : ""}`;
}

/** ADR 0014: "4 of 6 clients have a kit" (+ credentials still kept in the app's vault). */
export function kitSub(c: MenuCounts | null): string {
  if (!c || !c.clients) return "Drive folders, credentials sheet, vault";
  const base = `${c.clientsWithKit} of ${c.clients} client${c.clients === 1 ? "" : "s"} ${c.clients === 1 ? "has" : "have"} a kit`;
  return c.credentials ? `${base} · ${c.credentials} saved login${c.credentials === 1 ? "" : "s"}` : base;
}

export function menuSections(c: MenuCounts | null): MenuSection[] {
  const k = (n: number | undefined) => n ?? 0;
  return [
    {
      title: "Money",
      tone: "money",
      items: [
        { href: "/admin/dashboards?view=FIN", icon: BarChart3, label: "Finance", sub: financeSub(c), badge: badge(k(c?.invoicesToApprove) + k(c?.billsOverdue), "red") },
        { href: "/admin/drive-folders", icon: Folder, label: "Drive folders", sub: "Monthly Drive folders · invoices, bills, GST pack, cancelled" },
      ],
    },
    {
      title: "Clients",
      tone: "client",
      items: [
        { href: "/admin/clients", icon: Building2, label: "Clients", sub: `${k(c?.clients)} clients · GST, PAN, TDS` },
        // amber = active clients still without a Drive kit
        { href: "/admin/client-kit", icon: FolderKey, label: "Client kit", sub: kitSub(c), badge: badge(k(c?.clients) - k(c?.clientsWithKit), "amber") },
        { href: "/admin/vault?tab=SHARED_DRIVE_LINK", icon: HardDrive, label: "Shared links", sub: "Shared drive links · folders shared with clients" },
      ],
    },
    {
      title: "Team",
      tone: "team",
      items: [
        { href: "/admin/dashboards?view=HR", icon: CalendarCheck, label: "HR", sub: hrSub(c) },
        { href: "/admin/dashboards?view=TASK", icon: ListChecks, label: "Tasks", sub: taskSub(c), badge: badge(k(c?.tasksLate), "amber") },
        // the dashboards lost their action row (ADR 0016 addendum): Attendance and Inventory stay one tap away here
        { href: "/attendance", icon: UserCheck, label: "Attendance", sub: "Mark today · leave · monthly sheet" },
        { href: "/admin/inventory", icon: Clock, label: "Inventory", sub: "Hours available vs assigned" },
        { href: "/admin/people?role=EXECUTIVE", icon: Users, label: "Executives", sub: `${k(c?.executives)} people · specialities` },
        { href: "/admin/people?role=TEAM_LEADER", icon: UserRoundCheck, label: "Team leaders", sub: "One per team" },
        { href: "/admin/teams", icon: Layers, label: "Teams", sub: c?.teams.length ? c.teams.join(", ") : "Add your first team" },
        { href: "/admin/work-types", icon: Tag, label: "Work types", sub: `${k(c?.workTypes)} types across teams` },
      ],
    },
    {
      title: "Other",
      tone: "other",
      items: [
        { href: "/admin/requests", icon: Inbox, label: "Requests", sub: k(c?.requestsOpen) ? `${c!.requestsOpen} open` : "Finance, work and leave in one inbox", badge: badge(k(c?.requestsOpen), "red") },
        { href: "/notifications", icon: Bell, label: "Notifications", sub: k(c?.unread) ? `${c!.unread} unread` : "All caught up", badge: badge(k(c?.unread), "soft") },
        { href: "/admin/settings", icon: Settings, label: "Settings", sub: "Company, bank, invoice, TDS" },
        { href: "/api/auth/signout", icon: LogOut, label: "Sign out", danger: true },
      ],
    },
  ];
}

/** Search box: keep tiles whose label, old subtitle or section name contains the term; drop empty sections. */
export function filterSections(sections: MenuSection[], q: string): MenuSection[] {
  const term = q.trim().toLowerCase();
  if (!term) return sections;
  return sections
    .map((s) => ({ ...s, items: s.items.filter((it) => `${it.label} ${it.sub ?? ""} ${s.title}`.toLowerCase().includes(term)) }))
    .filter((s) => s.items.length);
}

/** Quick actions pinned at the bottom (owner: three, no "New task" / "Add" here — the dashboard "+" speed-dial adds things). */
export const QUICK_ACTIONS: QuickAction[] = [
  { href: "/admin/invoices?new=1", icon: FileText, label: "New invoice", tone: "money" },
  { href: "/admin/expenses/new", icon: Receipt, label: "Add expense", tone: "money" },
  { href: "/admin/requests?tab=FIN&fin=APPR", icon: Inbox, label: "Approvals", tone: "red" },
];
