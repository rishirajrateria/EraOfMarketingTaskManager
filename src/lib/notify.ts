import { prisma } from "@/lib/db";
import { bus } from "@/lib/events";
import type { NotificationKind, Prisma } from "@prisma/client";
import { isFeedKind } from "@/lib/notification-kinds";

export type NotifyInput = {
  userIds: string[];
  kind: NotificationKind;
  /** The short phrase. When `taskId` is set the feed shows the task title separately, so don't repeat it (ADR 0017). */
  title: string;
  body?: string;
  href?: string;
  taskId?: string;
  invoiceId?: string;
  /** post to the task's Google Chat space too (default: CompanySettings.notifyChatDefault, off unless enabled) */
  chat?: boolean;
};

/** Reminders sent without a feed row (bills due, invoices to approve — decisions live in Requests). Tests read it. */
export const reminderLog: { userIds: string[]; kind: NotificationKind; title: string; body: string; href: string | null }[] = [];

/** Push + email (+ Chat) for a notification; best-effort, never throws. A task's title heads the push. */
function sideChannels(input: NotifyInput, ids: string[]) {
  void (async () => {
    let title = input.title;
    let body = input.body ?? "";
    if (input.taskId) {
      try {
        const t = await prisma.task.findUnique({ where: { id: input.taskId }, select: { title: true } });
        if (t) {
          title = t.title;
          body = body ? `${input.title} · ${body}` : input.title;
        }
      } catch {
        /* keep the phrase */
      }
    }
    try {
      const { sendPushToUsers } = await import("@/lib/push");
      await sendPushToUsers(ids, { title, body, url: input.href ?? "/" });
    } catch {
      /* push optional */
    }
    let chatWanted = input.chat === true;
    if (input.chat === undefined && input.taskId) {
      try {
        const { getSettings } = await import("@/lib/settings");
        chatWanted = (await getSettings()).notifyChatDefault;
      } catch {
        chatWanted = false;
      }
    }
    if (input.taskId && chatWanted) {
      try {
        const { postTaskChatMessage } = await import("@/google/chat");
        await postTaskChatMessage(input.taskId, `${input.title}${input.body ? " — " + input.body : ""}`);
      } catch {
        /* chat optional */
      }
    }
    try {
      const { sendNotificationEmails } = await import("@/lib/email");
      await sendNotificationEmails(ids, title, body);
    } catch {
      /* email optional */
    }
  })();
}

/**
 * Fan-out helper: in-app feed row + SSE event + web push + email (+ optionally Chat).
 * Kinds that are decisions (PAYMENT_DUE, INVOICE_APPROVAL_DUE) never get a feed row — they go through `remind`.
 */
export async function notify(input: NotifyInput, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const ids = Array.from(new Set(input.userIds.filter(Boolean)));
  if (ids.length === 0) return [];
  if (!isFeedKind(input.kind)) {
    await remind(input);
    return [];
  }
  const rows = await Promise.all(
    ids.map((userId) =>
      tx.notification.create({
        data: { userId, kind: input.kind, title: input.title, body: input.body ?? "", href: input.href, taskId: input.taskId, invoiceId: input.invoiceId },
      }),
    ),
  );
  for (const r of rows) bus.publish({ type: "notification", userId: r.userId, notificationId: r.id });
  sideChannels(input, ids);
  return rows;
}

/** A reminder about something waiting in Requests: push + email only, no feed row and no bell count (ADR 0017). */
export async function remind(input: NotifyInput) {
  const ids = Array.from(new Set(input.userIds.filter(Boolean)));
  if (ids.length === 0) return;
  reminderLog.push({ userIds: ids, kind: input.kind, title: input.title, body: input.body ?? "", href: input.href ?? null });
  if (reminderLog.length > 200) reminderLog.splice(0, reminderLog.length - 200);
  sideChannels({ ...input, chat: false }, ids);
}

/** Everyone who should hear about a task: assignees + their team leaders + all admins. */
export async function taskStakeholderIds(taskId: string, opts: { includeAdmins?: boolean } = {}) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { assignees: { select: { user: { select: { id: true, teamLeaderId: true } } } }, createdById: true },
  });
  const ids = new Set<string>();
  if (!task) return [];
  for (const a of task.assignees) {
    ids.add(a.user.id);
    if (a.user.teamLeaderId) ids.add(a.user.teamLeaderId);
  }
  ids.add(task.createdById);
  if (opts.includeAdmins !== false) {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
    admins.forEach((a) => ids.add(a.id));
  }
  return Array.from(ids);
}

/** Who watches a task's progress (ADR 0017): every admin + the Team Leader(s) of its team(s) and of its assignees. */
export async function taskOverseerIds(taskId: string) {
  const [task, admins] = await Promise.all([
    prisma.task.findUnique({
      where: { id: taskId },
      select: { teams: { select: { team: { select: { leaderId: true } } } }, assignees: { select: { user: { select: { id: true, role: true, teamLeaderId: true } } } } },
    }),
    adminIds(),
  ]);
  const ids = new Set(admins);
  for (const t of task?.teams ?? []) if (t.team.leaderId) ids.add(t.team.leaderId);
  for (const a of task?.assignees ?? []) {
    if (a.user.teamLeaderId) ids.add(a.user.teamLeaderId);
    if (a.user.role === "TEAM_LEADER") ids.add(a.user.id);
  }
  return Array.from(ids);
}

export async function adminIds() {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  return admins.map((a) => a.id);
}

export async function hrIds() {
  const rows = await prisma.user.findMany({ where: { role: { in: ["HR", "ADMIN"] }, active: true }, select: { id: true } });
  return rows.map((a) => a.id);
}

/** Publish a task change only to the people who can see the task (assignees, their leaders, admins). */
export async function publishTaskChanged(taskId: string) {
  let userIds: string[] | undefined;
  try {
    userIds = await taskStakeholderIds(taskId);
  } catch {
    userIds = undefined;
  }
  bus.publish({ type: "task.changed", taskId, userIds });
}
