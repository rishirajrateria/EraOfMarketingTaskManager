import { prisma } from "@/lib/db";
import { bus } from "@/lib/events";
import type { NotificationKind, Prisma } from "@prisma/client";

export type NotifyInput = {
  userIds: string[];
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string;
  taskId?: string;
  /** post to the task's Google Chat space too (default true when taskId present) */
  chat?: boolean;
};

/**
 * Fan-out helper: in-app row + SSE event + web push + (optionally) Chat message.
 * Push and Chat are best-effort and never throw.
 */
export async function notify(input: NotifyInput, tx: Prisma.TransactionClient | typeof prisma = prisma) {
  const ids = Array.from(new Set(input.userIds.filter(Boolean)));
  if (ids.length === 0) return [];
  const rows = await Promise.all(
    ids.map((userId) =>
      tx.notification.create({
        data: {
          userId,
          kind: input.kind,
          title: input.title,
          body: input.body ?? "",
          href: input.href,
          taskId: input.taskId,
        },
      }),
    ),
  );
  for (const r of rows) bus.publish({ type: "notification", userId: r.userId, notificationId: r.id });
  // Fire-and-forget side channels
  void (async () => {
    try {
      const { sendPushToUsers } = await import("@/lib/push");
      await sendPushToUsers(ids, { title: input.title, body: input.body ?? "", url: input.href ?? "/" });
    } catch {
      /* push optional */
    }
    if (input.taskId && input.chat !== false) {
      try {
        const { postTaskChatMessage } = await import("@/google/chat");
        await postTaskChatMessage(input.taskId, `${input.title}${input.body ? " — " + input.body : ""}`);
      } catch {
        /* chat optional */
      }
    }
    if (rows.length) {
      try {
        const { sendNotificationEmails } = await import("@/lib/email");
        await sendNotificationEmails(ids, input.title, input.body ?? "");
      } catch {
        /* email optional */
      }
    }
  })();
  return rows;
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
