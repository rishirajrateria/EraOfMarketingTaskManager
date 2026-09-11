import type { Role } from "@prisma/client";

export type SessionUser = {
  id: string;
  role: Role;
  teamId: string | null;
  teamLeaderId: string | null;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export class AuthError extends Error {
  status: number;
  constructor(message = "Unauthorized", status = 401) {
    super(message);
    this.status = status;
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = "Forbidden") {
    super(message, 403);
  }
}

export async function currentUser(): Promise<SessionUser | null> {
  // Lazy import keeps this module free of next-auth for pure unit tests.
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user as SessionUser;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new AuthError();
  return u;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const u = await requireUser();
  if (!roles.includes(u.role)) throw new ForbiddenError(`Requires role ${roles.join("/")}`);
  return u;
}

export const isAdmin = (u: SessionUser) => u.role === "ADMIN";
export const isTeamLeader = (u: SessionUser) => u.role === "TEAM_LEADER";
export const isExecutive = (u: SessionUser) => u.role === "EXECUTIVE";
export const isHR = (u: SessionUser) => u.role === "HR";
export const hasTaskDashboard = (u: SessionUser) =>
  u.role === "ADMIN" || u.role === "TEAM_LEADER" || u.role === "EXECUTIVE";

/** Capability matrix from SPEC §2. Pure function so it is unit-testable. */
export const can = {
  assignToTeamLeader: (u: SessionUser) => isAdmin(u),
  assignToExecutive: (u: SessionUser) => isTeamLeader(u),
  selfAssign: (u: SessionUser) => hasTaskDashboard(u),
  startTask: (u: SessionUser) => isAdmin(u) || isTeamLeader(u),
  requestFinish: (u: SessionUser) => isAdmin(u) || isTeamLeader(u),
  approveFinish: (u: SessionUser) => isAdmin(u),
  pauseResume: (u: SessionUser) => isAdmin(u),
  editTask: (u: SessionUser) => isAdmin(u),
  deleteTask: (u: SessionUser) => isAdmin(u),
  raiseDoubt: (u: SessionUser) => isTeamLeader(u),
  raiseReview: (u: SessionUser) => isTeamLeader(u) || isExecutive(u),
  restartTask: (u: SessionUser) => isAdmin(u) || isTeamLeader(u),
  scheduleMeeting: (u: SessionUser) => hasTaskDashboard(u),
  menuTray: (u: SessionUser) => isAdmin(u),
  attendanceDashboard: (u: SessionUser) => isAdmin(u) || isHR(u),
  approveLeave: (u: SessionUser) => isAdmin(u) || isHR(u),
  manageVault: (u: SessionUser) => isAdmin(u),
  financeRead: (u: SessionUser) => isAdmin(u), // CA access is parked; Admin shares finance data manually
  financeWrite: (u: SessionUser) => isAdmin(u),
  resolveDoubt: (u: SessionUser) => isAdmin(u),
};

export function assert(cond: unknown, message = "Forbidden"): asserts cond {
  if (!cond) throw new ForbiddenError(message);
}
