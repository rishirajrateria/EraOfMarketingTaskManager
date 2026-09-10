/**
 * Leave queries (SPEC §11.5, §2): own leaves and the HR/Admin leave inbox.
 */
import type { LeaveStatus, RequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { fromDbDate, toDbDate } from "@/server/inventory/compute";
import { tasksAffectedByLeave } from "@/server/scheduling/shift";

export const APPROVED_LEAVE: LeaveStatus[] = ["HR_APPROVED", "ADMIN_APPROVED"];

export type LeaveChangePayload = { cancel: true } | { from: string; to: string; reason?: string };

export type LeaveSummary = {
  id: string;
  userId: string;
  userName: string;
  from: string;
  to: string;
  reason: string;
  status: LeaveStatus;
  tasksShiftedAt: string | null;
  createdAt: string;
  pendingChange: { requestId: string; payload: LeaveChangePayload; status: RequestStatus } | null;
};

type LeaveRow = {
  id: string;
  userId: string;
  from: Date;
  to: Date;
  reason: string;
  status: LeaveStatus;
  tasksShiftedAt: Date | null;
  createdAt: Date;
  user: { name: string };
  requests: { id: string; type: string; status: RequestStatus; payload: unknown }[];
};

function summarize(l: LeaveRow): LeaveSummary {
  const change = l.requests.find((r) => r.type === "APPROVED_CHANGE" && r.status === "OPEN");
  return {
    id: l.id,
    userId: l.userId,
    userName: l.user.name,
    from: fromDbDate(l.from),
    to: fromDbDate(l.to),
    reason: l.reason,
    status: l.status,
    tasksShiftedAt: l.tasksShiftedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    pendingChange: change ? { requestId: change.id, payload: change.payload as LeaveChangePayload, status: change.status } : null,
  };
}

const leaveInclude = { user: { select: { name: true } }, requests: { select: { id: true, type: true, status: true, payload: true } } } as const;

export async function myLeaves(userId: string): Promise<LeaveSummary[]> {
  const rows = await prisma.leave.findMany({ where: { userId }, include: leaveInclude, orderBy: { from: "desc" }, take: 50 });
  return rows.map(summarize);
}

export type LeaveInbox = {
  pending: LeaveSummary[];
  /** Approved leaves (not yet past) whose window still contains open tasks. */
  needsShift: (LeaveSummary & { affected: { id: string; title: string }[] })[];
  changeRequests: (LeaveSummary & { requestId: string; payload: LeaveChangePayload; raisedBy: string; note: string })[];
  recent: LeaveSummary[];
};

export async function leaveInbox(): Promise<LeaveInbox> {
  const s = await getSettings();
  const today = toDbDate(dateKey(new Date(), s.timezone));
  const [pending, approved, changes, recent] = await Promise.all([
    prisma.leave.findMany({ where: { status: "REQUESTED" }, include: leaveInclude, orderBy: { createdAt: "asc" } }),
    prisma.leave.findMany({ where: { status: { in: APPROVED_LEAVE }, to: { gte: today }, tasksShiftedAt: null }, include: leaveInclude, orderBy: { from: "asc" } }),
    prisma.request.findMany({
      where: { type: "APPROVED_CHANGE", status: "OPEN", leaveId: { not: null } },
      include: { leave: { include: leaveInclude }, raisedBy: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.leave.findMany({ where: { status: { not: "REQUESTED" } }, include: leaveInclude, orderBy: { updatedAt: "desc" }, take: 20 }),
  ]);
  const needsShift: LeaveInbox["needsShift"] = [];
  for (const l of approved) {
    const affected = await tasksAffectedByLeave(l.id);
    if (affected.length) needsShift.push({ ...summarize(l), affected });
  }
  return {
    pending: pending.map(summarize),
    needsShift,
    changeRequests: changes
      .filter((r) => r.leave)
      .map((r) => ({ ...summarize(r.leave!), requestId: r.id, payload: r.payload as LeaveChangePayload, raisedBy: r.raisedBy.name, note: r.note })),
    recent: recent.map(summarize),
  };
}
