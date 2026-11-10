import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient | typeof prisma;

export async function audit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  before?: unknown,
  after?: unknown,
  tx: Tx = prisma,
) {
  await tx.auditLog.create({
    data: {
      actorId,
      action,
      entityType,
      entityId,
      before: before === undefined ? undefined : (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue),
      after: after === undefined ? undefined : (JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue),
    },
  });
}
