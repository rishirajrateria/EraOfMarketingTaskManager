"use server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";

export async function markAllRead(): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    safeRevalidate("/notifications", "/");
    return undefined;
  });
}

export async function markRead(id: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    await prisma.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } });
    return undefined;
  });
}

export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string): Promise<ActionResult<undefined>> {
  return wrap(async () => {
    const user = await requireUser();
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: { userId: user.id, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
      create: { userId: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    });
    return undefined;
  });
}
