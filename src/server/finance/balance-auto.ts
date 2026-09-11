import { prisma } from "@/lib/db";
import { adminIds, notify } from "@/lib/notify";
import { generateBalanceInvoiceCore } from "@/server/finance/invoice-core";
import { formatINRPlain } from "@/server/finance/money";

/**
 * AUTO balance mode (SPEC §11.3): once the client's work is done the balance invoice is drafted — never sent —
 * and every Admin is asked to review it. Called by the invoices job.
 */

/** "Work is done" = no active WORK task for the client, and at least one task approved complete after `since`. */
export async function clientWorkComplete(clientId: string, since: Date): Promise<boolean> {
  const base = { clientId, type: "WORK" as const, deletedAt: null };
  const [active, approved] = await Promise.all([
    prisma.task.count({ where: { ...base, status: { not: "COMPLETED" } } }),
    prisma.task.count({ where: { ...base, status: "COMPLETED", approvedAt: { gt: since } } }),
  ]);
  return active === 0 && approved > 0;
}

/**
 * Drafts the balance invoice for every sent AUTO-mode advance whose client work is complete.
 * Idempotent: advances that already have a balance invoice are excluded by the query (balanceOfId is unique).
 */
export async function draftAutoBalanceInvoices(): Promise<number> {
  const advances = await prisma.invoice.findMany({
    where: { paymentMode: "ADVANCE", balanceMode: "AUTO", balanceInvoice: null, status: { notIn: ["DRAFT", "SCHEDULED"] } },
    select: { id: true, number: true, clientId: true, createdAt: true },
  });
  let drafted = 0;
  for (const adv of advances) {
    try {
      if (!(await clientWorkComplete(adv.clientId, adv.createdAt))) continue;
      const bal = await generateBalanceInvoiceCore(adv.id, null, false);
      await notify({
        userIds: await adminIds(),
        kind: "GENERIC",
        title: `Balance invoice ready to review — ${bal.number}`,
        body: `${bal.client.name} · ${formatINRPlain(bal.total.toNumber())} · balance of ${adv.number}. Drafted automatically; review and send.`,
        href: `/admin/invoices/${bal.id}`,
      });
      drafted++;
    } catch (e) {
      console.error("[jobs/invoices] auto balance draft failed", adv.id, e);
    }
  }
  return drafted;
}
