"use server";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { clientDisplayName } from "@/server/finance/file-names";
import { hasKit } from "@/server/clients/kit-paths";
import type { KitPickerClient } from "@/components/dashboard/fab-model";

/** Dashboard "+" → Client kit (ADR 0016 addendum): active clients with their kit state. Admin only; read when the sheet opens. */
export async function kitPickerClients(): Promise<ActionResult<KitPickerClient[]>> {
  return wrap(async () => {
    await requireRole("ADMIN");
    const rows = await prisma.client.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, businessName: true, kitFolderId: true, kitBrandId: true, kitCredentialsId: true, kitSheetId: true, kitWorkId: true, kitReportsId: true },
    });
    return rows.map((c) => {
      const ready = hasKit(c);
      return { id: c.id, name: clientDisplayName(c), ready, partial: !ready && Boolean(c.kitFolderId) };
    });
  });
}
