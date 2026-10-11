/**
 * Notifications = a feed of what happened (ADR 0017, prototype `NK` / `PAGES.notifications`). Pure and client-safe:
 * each kind's colour (the task-card colour it is about), label, icon and filter group; where a tap goes; Today /
 * Yesterday / date grouping. Decisions (bills due, invoices to approve) are Requests, never feed rows.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { NotificationKind, Role } from "@prisma/client";
import { dateKey } from "@/lib/time";

/** Card colours: green started / finished / money in · red late / overdue · yellow paused · purple doubt · grey completed · blue assigned / info · amber leave / bill soon. */
export type NotifTone = "green" | "red" | "yellow" | "purple" | "grey" | "blue" | "amber";
export type NotifIcon = "play" | "clock" | "check" | "pause" | "help" | "plus" | "calendar" | "rupee" | "bell";
export type NotifGroup = "TASKS" | "PEOPLE" | "MONEY";
export type KindMeta = { tone: NotifTone; label: string; icon: NotifIcon; group: NotifGroup };

const T = (tone: NotifTone, label: string, icon: NotifIcon, group: NotifGroup = "TASKS"): KindMeta => ({ tone, label, icon, group });

export const KIND_META: Record<NotificationKind, KindMeta> = {
  TASK_ASSIGNED: T("blue", "Assigned", "plus"),
  TASK_STARTED: T("green", "Started", "play"),
  TASK_STARTED_LATE: T("red", "Started late", "play"),
  TASK_PAUSED: T("yellow", "Paused", "pause"),
  TASK_RESUMED: T("green", "Resumed", "play"),
  FINISH_REQUESTED: T("green", "Done from their side", "check"),
  FINISH_APPROVED: T("grey", "Completed", "check"),
  TASK_COMPLETED: T("grey", "Completed", "check"),
  FINISH_REJECTED: T("blue", "Sent back", "bell"),
  DOUBT_RAISED: T("purple", "Doubt", "help"),
  DOUBT_RESOLVED: T("purple", "Doubt cleared", "help"),
  REVIEW_REQUESTED: T("blue", "Review asked", "bell"),
  TASK_OVERDUE: T("red", "Overdue", "clock"),
  TASK_NOT_STARTED: T("red", "Not started", "clock"),
  TASK_PAST_END: T("red", "Past end time", "clock"),
  TASK_SHIFTED: T("blue", "Time moved", "clock"),
  INTEGRATION_FAILED: T("red", "Google sync", "bell"),
  GENERIC: T("blue", "Update", "bell"),
  LEAVE_REQUESTED: T("amber", "Leave asked", "calendar", "PEOPLE"),
  LEAVE_APPROVED: T("amber", "Leave approved", "calendar", "PEOPLE"),
  LEAVE_REJECTED: T("amber", "Leave declined", "calendar", "PEOPLE"),
  VAULT_ACCESS_GRANTED: T("blue", "Vault access", "bell", "PEOPLE"),
  VAULT_ACCESS_EXPIRING: T("amber", "Vault access", "bell", "PEOPLE"),
  INVOICE_SENT: T("blue", "Invoice sent", "rupee", "MONEY"),
  INVOICE_PAID: T("green", "Payment in", "rupee", "MONEY"),
  PAYMENT_RECEIVED: T("green", "Payment in", "rupee", "MONEY"),
  INVOICE_APPROVAL_DUE: T("amber", "To approve", "rupee", "MONEY"),
  PAYMENT_DUE: T("amber", "Bill due", "rupee", "MONEY"),
  WORK_ON_HOLD: T("red", "Work on hold", "rupee", "MONEY"),
  WORK_RESUMED: T("green", "Work resumed", "rupee", "MONEY"),
  TDS_THRESHOLD: T("red", "TDS", "rupee", "MONEY"),
};

/** Decisions live in Requests: these kinds are reminders (push / email) and never shown in the feed or the bell count. */
export const FEED_HIDDEN_KINDS: NotificationKind[] = ["PAYMENT_DUE", "INVOICE_APPROVAL_DUE"];
export const isFeedKind = (k: NotificationKind) => !FEED_HIDDEN_KINDS.includes(k);

export const FEED_FILTERS = ["ALL", "UNREAD", "TASKS", "PEOPLE", "MONEY"] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];
export const parseFeedFilter = (v: string | null | undefined): FeedFilter => (FEED_FILTERS.includes((v ?? "").toUpperCase() as FeedFilter) ? ((v ?? "").toUpperCase() as FeedFilter) : "ALL");
export const feedHref = (f: FeedFilter) => (f === "ALL" ? "/notifications" : `/notifications?show=${f}`);

/** The feed kinds of a group (for the query's `kind in (…)`). */
export function kindsOfGroup(g: NotifGroup): NotificationKind[] {
  return (Object.keys(KIND_META) as NotificationKind[]).filter((k) => KIND_META[k].group === g && isFeedKind(k));
}
export const FEED_KINDS: NotificationKind[] = (Object.keys(KIND_META) as NotificationKind[]).filter(isFeedKind);

/** Kinds whose task is completed when the update is read — the dashboard must show completed tasks to find the card. */
const COMPLETION_KINDS: NotificationKind[] = ["TASK_COMPLETED", "FINISH_APPROVED"];

/** The dashboard deep link that scrolls to a task card, flashes it and opens its (i) sheet. */
export function taskDeepLink(taskId: string, opts: { completed?: boolean } = {}): string {
  return `/dashboard?task=${encodeURIComponent(taskId)}${opts.completed ? "&completed=1" : ""}`;
}

export type TargetInput = {
  kind: NotificationKind;
  href: string | null;
  taskId: string | null;
  invoiceId: string | null;
  /** The task as it is now (null = gone / not found). */
  task?: { status: string; deleted: boolean } | null;
};

/**
 * Where tapping a notification goes (null = nowhere, it's only marked read):
 * task → the dashboard deep link (HR / CA have no task list) · invoice → its page · leave → Admin's Requests HR tab,
 * HR's leave inbox, everyone else's leave page · otherwise the stored href.
 */
export function notificationTarget(n: TargetInput, role: Role): string | null {
  const meta = KIND_META[n.kind];
  if (n.taskId && n.task !== null && role !== "HR" && role !== "CA") {
    if (n.task?.deleted) return null;
    return taskDeepLink(n.taskId, { completed: n.task?.status === "COMPLETED" || COMPLETION_KINDS.includes(n.kind) });
  }
  if (n.invoiceId) return role === "ADMIN" || role === "CA" ? `/admin/invoices/${n.invoiceId}` : null;
  if (meta.group === "PEOPLE" && n.kind.startsWith("LEAVE_")) {
    if (role === "ADMIN") return "/admin/requests?tab=HR";
    if (role === "HR") return n.href?.startsWith("/requests/leave") ? n.href : "/requests/leave";
    return "/leave";
  }
  if (n.taskId) return null; // HR / CA: task links lead nowhere
  return n.href && n.href !== "/" ? n.href : null;
}

/** "Today" / "Yesterday" / "8 Oct" (another year: "8 Oct 2025") in the company timezone. */
export function dayLabel(at: Date, now: Date, tz: string): string {
  const k = dateKey(at, tz);
  if (k === dateKey(now, tz)) return "Today";
  if (k === dateKey(new Date(now.getTime() - 86_400_000), tz)) return "Yesterday";
  return formatInTimeZone(at, tz, k.slice(0, 4) === dateKey(now, tz).slice(0, 4) ? "d MMM" : "d MMM yyyy");
}

/** Consecutive rows (newest first) grouped under their day label. */
export function groupByDay<R extends { createdAt: Date }>(rows: R[], now: Date, tz: string): { label: string; rows: R[] }[] {
  const out: { label: string; rows: R[] }[] = [];
  for (const r of rows) {
    const label = dayLabel(r.createdAt, now, tz);
    const last = out[out.length - 1];
    if (last && last.label === label) last.rows.push(r);
    else out.push({ label, rows: [r] });
  }
  return out;
}
