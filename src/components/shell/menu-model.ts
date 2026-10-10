import { CalendarCheck, Clock, ListChecks, LogOut, Settings, type LucideIcon } from "lucide-react";
import type { MenuCounts } from "@/server/shell/menu";

/**
 * Admin menu model (ADR 0011 v3 tiles, ADR 0016 dashboards). Pure data so tests can check groups, order, labels,
 * badges and links without rendering. Colour = category: Team yellow, Other purple (Money green and Clients blue are
 * kept for tiles that may return). Only what nothing else reaches stays (ADR 0016 addendum, nav v4): Finance,
 * Requests, Notifications, Attendance and the Drive pages (Folders) are the bottom nav / dashboards, Clients and every
 * add are the + speed dial (with its eyes), Approvals is Requests › Finance › Approvals. Empty groups disappear.
 */
export type Tone = "money" | "client" | "team" | "other" | "red";
export type BadgeTone = "red" | "amber" | "soft";
export type Badge = { n: number; tone: BadgeTone } | null;
/** `sub` is the old one-line status: on a tile it becomes the title / aria-label and is still searched. */
export type MenuItem = { href: string; icon: LucideIcon; label: string; sub?: string; badge?: Badge; danger?: boolean };
export type MenuSection = { title: string; tone: Tone; items: MenuItem[] };

const badge = (n: number, tone: BadgeTone): Badge => (n > 0 ? { n, tone } : null);

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
  const sections: MenuSection[] = [
    {
      title: "Team",
      tone: "team",
      items: [
        { href: "/admin/dashboards?view=HR", icon: CalendarCheck, label: "HR", sub: hrSub(c) },
        { href: "/admin/dashboards?view=TASK", icon: ListChecks, label: "Tasks", sub: taskSub(c), badge: badge(k(c?.tasksLate), "amber") },
        // Attendance is a bottom nav tab (nav v4); Inventory stays one tap away here
        { href: "/admin/inventory", icon: Clock, label: "Inventory", sub: "Hours available vs assigned" },
        // Executives, Team leaders, Teams and Work types left the menu: the + speed dial adds them and its eyes list them
      ],
    },
    {
      title: "Other",
      tone: "other",
      // Requests and Notifications are bottom nav tabs (with their counts); Drive folders / Shared links are the Folders tab
      items: [
        { href: "/admin/settings", icon: Settings, label: "Settings", sub: "Company, bank, invoice, TDS" },
        { href: "/api/auth/signout", icon: LogOut, label: "Sign out", danger: true },
      ],
    },
  ];
  return sections.filter((s) => s.items.length);
}

/** Search box: keep tiles whose label, old subtitle or section name contains the term; drop empty sections. */
export function filterSections(sections: MenuSection[], q: string): MenuSection[] {
  const term = q.trim().toLowerCase();
  if (!term) return sections;
  return sections
    .map((s) => ({ ...s, items: s.items.filter((it) => `${it.label} ${it.sub ?? ""} ${s.title}`.toLowerCase().includes(term)) }))
    .filter((s) => s.items.length);
}

/** Long single words get a soft hyphen in the middle so a narrow tile wraps them as "Notifi-cations" / "Atten-dance". */
export const SOFT_HYPHEN = "­";
export const softHyphenate = (label: string) => label.replace(/\S{10,}/g, (w) => `${w.slice(0, Math.floor(w.length / 2))}${SOFT_HYPHEN}${w.slice(Math.floor(w.length / 2))}`);
