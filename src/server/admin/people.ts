import type { Prisma, Role, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";

/** Helpers for the people actions (SPEC §4, §11.7). No "use server" here — plain module. */

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Admin",
  TEAM_LEADER: "Team Leader",
  EXECUTIVE: "Executive",
  HR: "HR",
  CA: "CA (parked)",
};

/** Field subset written to the audit log. */
export function publicUser(u: User) {
  return {
    email: u.email,
    name: u.name,
    role: u.role,
    teamId: u.teamId,
    teamLeaderId: u.teamLeaderId,
    dailyCapacityMinutes: u.dailyCapacityMinutes,
    workingDays: u.workingDays,
    active: u.active,
    notifyByEmail: u.notifyByEmail,
  };
}

/** Workspace-domain rule (SPEC §4). Applies to every role — CA access (the only external role) is parked (ADR 0004). */
export function assertWorkspaceEmail(email: string): void {
  const domain = env.workspaceDomain.trim().toLowerCase();
  if (!domain) return;
  if (!email.endsWith("@" + domain)) throw new Error(`Email must end with @${domain}`);
}

export type HierarchyInput = { role: Role; teamId: string | null; teamLeaderId: string | null };

/** Validates team / reporting-leader references and returns the normalised pair. */
export async function resolveHierarchy(
  input: HierarchyInput,
  selfId?: string,
): Promise<{ teamId: string | null; teamLeaderId: string | null }> {
  if (input.teamId) {
    const team = await prisma.team.findUnique({ where: { id: input.teamId }, select: { id: true } });
    if (!team) throw new Error("Team not found");
  }
  if (input.role !== "EXECUTIVE") return { teamId: input.teamId, teamLeaderId: null };
  if (!input.teamLeaderId) throw new Error("Executives need a reporting Team Leader");
  if (input.teamLeaderId === selfId) throw new Error("A user cannot report to themselves");
  const leader = await prisma.user.findUnique({
    where: { id: input.teamLeaderId },
    select: { id: true, role: true, active: true, teamId: true },
  });
  if (!leader || leader.role !== "TEAM_LEADER" || !leader.active) {
    throw new Error("Reporting Team Leader must be an active Team Leader");
  }
  return { teamId: input.teamId ?? leader.teamId, teamLeaderId: leader.id };
}

/** Best-effort invite email (SPEC §11.7). Never throws. */
export async function sendInvite(user: Pick<User, "email" | "name" | "role">): Promise<void> {
  try {
    const [{ sendMail }, settings] = await Promise.all([import("@/google/gmail"), getSettings()]);
    const url = process.env.AUTH_URL ?? "";
    await sendMail({
      to: user.email,
      subject: `You have been added to ${settings.companyName} Task Manager`,
      text:
        `Hi ${user.name},\n\n` +
        `You have been added to ${settings.companyName} Task Manager as ${ROLE_LABEL[user.role]}.\n` +
        `Sign in with your Google account${url ? ` at ${url}/login` : ""}.\n\n` +
        `Regards,\n${settings.companyName}`,
    });
  } catch {
    // Invite delivery is best-effort; the user row exists regardless.
  }
}

/** Translates Prisma unique-constraint failures into a friendly message. */
export async function withUnique<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const code = (e as Prisma.PrismaClientKnownRequestError | undefined)?.code;
    if (code === "P2002") throw new Error(message);
    throw e;
  }
}
