import { prisma } from "@/lib/db";
import type { Role } from "@prisma/client";

export type RequestItem = {
  id: string;
  type: string;
  status: string;
  note: string;
  createdAt: string;
  raisedBy: { id: string; name: string };
  task: { id: string; title: string; status: string; client: string } | null;
  leave: { id: string; userName: string; from: string; to: string; status: string } | null;
  payload: unknown;
};

export async function listRequests(targetRole: Role, opts: { includeResolved?: boolean } = {}): Promise<RequestItem[]> {
  const rows = await prisma.request.findMany({
    where: { targetRole, ...(opts.includeResolved ? {} : { status: "OPEN" }) },
    include: {
      raisedBy: { select: { id: true, name: true } },
      task: { select: { id: true, title: true, status: true, client: { select: { name: true } } } },
      leave: { select: { id: true, from: true, to: true, status: true, user: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    raisedBy: r.raisedBy,
    task: r.task ? { id: r.task.id, title: r.task.title, status: r.task.status, client: r.task.client.name } : null,
    leave: r.leave ? { id: r.leave.id, userName: r.leave.user.name, from: r.leave.from.toISOString(), to: r.leave.to.toISOString(), status: r.leave.status } : null,
    payload: r.payload,
  }));
}
