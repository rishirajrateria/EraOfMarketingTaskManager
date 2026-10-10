/**
 * The notifications feed (ADR 0017): newest first, filtered by All · Unread · Tasks · People · Money, each row with
 * the task it's about (title, client, team) or the invoice's client, grouped by Today / Yesterday / date.
 * Decision kinds (bills due, invoices to approve) are never listed or counted — they live in Requests.
 */
import type { NotificationKind, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fmtTime } from "@/lib/time";
import { FEED_KINDS, KIND_META, groupByDay, kindsOfGroup, notificationTarget, type FeedFilter, type NotifIcon, type NotifTone } from "@/lib/notification-kinds";

export const FEED_LIMIT = 150;

export type FeedRow = {
  id: string;
  kind: NotificationKind;
  tone: NotifTone;
  icon: NotifIcon;
  /** Line 1: the task title when tied to a task, else the text. */
  headline: string;
  /** Line 2: the short phrase (task rows only; + the note when there is one). */
  phrase: string | null;
  /** Line 3: kind label · client · team · time. */
  meta: string;
  read: boolean;
  /** Where a tap goes (null = only marks it read). */
  target: string | null;
  createdAt: Date;
};

export type Feed = { groups: { label: string; rows: FeedRow[] }[]; unread: number; total: number };

/** Prisma `where` for a user's feed under a filter. */
export function feedWhere(userId: string, filter: FeedFilter): Prisma.NotificationWhereInput {
  const base: Prisma.NotificationWhereInput = { userId, kind: { in: FEED_KINDS } };
  if (filter === "UNREAD") return { ...base, readAt: null };
  if (filter === "TASKS" || filter === "PEOPLE" || filter === "MONEY") return { ...base, kind: { in: kindsOfGroup(filter) } };
  return base;
}

/** The bell's number: unread feed rows (reminder kinds never count). */
export function unreadNotificationCount(userId: string) {
  return prisma.notification.count({ where: { ...feedWhere(userId, "UNREAD") } });
}

export async function loadFeed(user: { id: string; role: Role }, filter: FeedFilter, tz: string, now = new Date()): Promise<Feed> {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where: feedWhere(user.id, filter), orderBy: { createdAt: "desc" }, take: FEED_LIMIT }),
    unreadNotificationCount(user.id),
  ]);
  const taskIds = Array.from(new Set(rows.map((r) => r.taskId).filter((x): x is string => !!x)));
  const invoiceIds = Array.from(new Set(rows.map((r) => r.invoiceId).filter((x): x is string => !!x)));
  const [tasks, invoices] = await Promise.all([
    taskIds.length
      ? prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, title: true, status: true, deletedAt: true, client: { select: { name: true } }, teams: { select: { team: { select: { name: true } } } } },
        })
      : [],
    invoiceIds.length ? prisma.invoice.findMany({ where: { id: { in: invoiceIds } }, select: { id: true, client: { select: { name: true } } } }) : [],
  ]);
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const invById = new Map(invoices.map((i) => [i.id, i]));

  const out: FeedRow[] = rows.map((n) => {
    const m = KIND_META[n.kind];
    const t = n.taskId ? taskById.get(n.taskId) : undefined;
    const inv = n.invoiceId ? invById.get(n.invoiceId) : undefined;
    const team = t?.teams.map((x) => x.team.name).join(", ");
    const note = n.body?.trim() ? n.body.trim() : null;
    return {
      id: n.id,
      kind: n.kind,
      tone: m.tone,
      icon: m.icon,
      headline: t ? t.title : n.title,
      phrase: t ? [n.title, note].filter(Boolean).join(" · ") : note,
      meta: [m.label, t?.client?.name ?? inv?.client.name, team || null, fmtTime(n.createdAt, tz)].filter(Boolean).join(" · "),
      read: !!n.readAt,
      target: notificationTarget({ kind: n.kind, href: n.href, taskId: n.taskId, invoiceId: n.invoiceId, task: n.taskId ? (t ? { status: t.status, deleted: !!t.deletedAt } : null) : undefined }, user.role),
      createdAt: n.createdAt,
    };
  });
  return { groups: groupByDay(out, now, tz), unread, total: out.length };
}
