import { prisma } from "@/lib/db";
import type { Prisma, Role } from "@prisma/client";

export type RequestItem = {
  id: string;
  type: string;
  status: string;
  note: string;
  /** REVIEW / TIME_CHANGE: the pill under review — "date" | "time" | "mins" (ADR 0015). */
  field: string | null;
  createdAt: string;
  raisedBy: { id: string; name: string };
  /** `clientId` / `teamIds` narrow the Work tab by the task's client and team(s) (ADR 0016 addendum). */
  task: { id: string; title: string; status: string; client: string; clientId: string; teamIds: string[] } | null;
  leave: { id: string; userName: string; from: string; to: string; status: string } | null;
  payload: unknown;
};

const include = {
  raisedBy: { select: { id: true, name: true } },
  task: { select: { id: true, title: true, status: true, clientId: true, client: { select: { name: true } }, teams: { select: { teamId: true } } } },
  leave: { select: { id: true, from: true, to: true, status: true, user: { select: { name: true } } } },
} satisfies Prisma.RequestInclude;

function toItem(r: Prisma.RequestGetPayload<{ include: typeof include }>): RequestItem {
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    note: r.note,
    field: r.field,
    createdAt: r.createdAt.toISOString(),
    raisedBy: r.raisedBy,
    task: r.task
      ? { id: r.task.id, title: r.task.title, status: r.task.status, client: r.task.client.name, clientId: r.task.clientId, teamIds: r.task.teams.map((t) => t.teamId) }
      : null,
    leave: r.leave ? { id: r.leave.id, userName: r.leave.user.name, from: r.leave.from.toISOString(), to: r.leave.to.toISOString(), status: r.leave.status } : null,
    payload: r.payload,
  };
}

export async function listRequests(targetRole: Role, opts: { includeResolved?: boolean } = {}): Promise<RequestItem[]> {
  const rows = await prisma.request.findMany({
    where: { targetRole, ...(opts.includeResolved ? {} : { status: "OPEN" }) },
    include,
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(toItem);
}

/**
 * Admin's one inbox (ADR 0016): everything addressed to Admin plus leave requests (addressed to HR, which Admin can
 * approve too), newest first.
 */
export async function listInboxRequests(opts: { includeResolved?: boolean } = {}): Promise<RequestItem[]> {
  const rows = await prisma.request.findMany({
    where: { OR: [{ targetRole: "ADMIN" }, { type: "LEAVE" }], ...(opts.includeResolved ? {} : { status: "OPEN" }) },
    include,
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return rows.map(toItem);
}

export type NamedOption = { id: string; name: string };

/** Active teams and clients (by name) for the inbox's Work tab rows (ADR 0016 addendum). */
export async function workFilterOptions(): Promise<{ teams: NamedOption[]; clients: NamedOption[] }> {
  const [teams, clients] = await Promise.all([
    prisma.team.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.client.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { teams, clients };
}
