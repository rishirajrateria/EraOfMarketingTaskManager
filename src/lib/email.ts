import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";

/** Optional per-user email notifications via Gmail (SPEC §10). */
export async function sendNotificationEmails(userIds: string[], subject: string, body: string) {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, notifyByEmail: true, active: true },
    select: { email: true },
  });
  if (users.length === 0) return;
  const { sendMail } = await import("@/google/gmail");
  const settings = await getSettings();
  await Promise.all(
    users.map((u) =>
      sendMail({ to: u.email, subject: `[${settings.companyName}] ${subject}`, text: body || subject }).catch(
        () => undefined,
      ),
    ),
  );
}
