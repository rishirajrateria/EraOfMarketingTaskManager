"use server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";

/** Self-service profile actions for /me (any signed-in user). */

export async function setNotifyByEmail(value: boolean): Promise<ActionResult<{ notifyByEmail: boolean }>> {
  return wrap(async () => {
    const me = await requireUser();
    const before = await prisma.user.findUnique({ where: { id: me.id }, select: { notifyByEmail: true } });
    if (!before) throw new Error("User not found");
    const after = await prisma.user.update({ where: { id: me.id }, data: { notifyByEmail: Boolean(value) }, select: { notifyByEmail: true } });
    await audit(me.id, "user.notifyByEmail", "User", me.id, before, after);
    safeRevalidate("/me");
    return after;
  });
}
