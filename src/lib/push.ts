import webpush from "web-push";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!env.vapidPublic || !env.vapidPrivate) return false;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublic, env.vapidPrivate);
  configured = true;
  return true;
}

export async function sendPushToUsers(userIds: string[], payload: { title: string; body: string; url: string }) {
  if (!ensureConfigured()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        }
      }
    }),
  );
}
