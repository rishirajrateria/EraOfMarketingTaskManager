import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireFinancePage } from "@/server/finance/guard";
import { getInvoiceDetail } from "@/server/finance/queries";
import { getSettings } from "@/lib/settings";
import { InvoiceActions } from "@/components/finance/InvoiceActions";
import { ScheduleBlock } from "@/components/finance/ScheduleBlock";
import { AmountsBlock, ClientBlock, DetailHeader, NotesBlock, PaymentsBlock, RelatedDocsBlock, SendStateBlock } from "@/components/finance/InvoiceDetailSections";

export const dynamic = "force-dynamic";
const OPEN_TASKS = ["ASSIGNED", "STARTED", "FINISH_REQUESTED"] as const;

/** Invoice detail (ADR 0005): header, amounts, client, schedule, approval + delivery, related docs, payments, actions. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireFinancePage();
  const { id } = await params;
  const [inv, settings] = await Promise.all([getInvoiceDetail(id), getSettings()]);
  if (!inv) notFound();
  const [client, openTasks] = await Promise.all([
    prisma.client.findUnique({ where: { id: inv.clientId }, select: { tdsPercent: true } }),
    prisma.task.count({ where: { clientId: inv.clientId, deletedAt: null, status: { in: [...OPEN_TASKS] } } }),
  ]);
  const tz = settings.timezone;
  return (
    <div className="flex flex-1 flex-col">
      <DetailHeader inv={inv} tz={tz} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 pt-3">
        {inv.status === "AWAITING_APPROVAL" ? (
          <div role="status" className="mx-4 mb-3 rounded-xl border border-white/60 bg-amber-100/70 px-3 py-2 text-sm text-amber-900 backdrop-blur-sm">
            <b>Awaiting your approval.</b> Nothing has been sent. Review, then tap <b>Approve &amp; send</b> below to allocate the number and deliver it.
          </div>
        ) : null}
        <AmountsBlock inv={inv} />
        <NotesBlock inv={inv} tz={tz} />
        <ClientBlock inv={inv} tz={tz} />
        <ScheduleBlock inv={inv} tz={tz} canWrite={user.canWrite} />
        <SendStateBlock inv={inv} tz={tz} />
        <RelatedDocsBlock inv={inv} tz={tz} />
        <PaymentsBlock inv={inv} tz={tz} />
      </div>
      {user.canWrite ? (
        <InvoiceActions
          inv={inv}
          tz={tz}
          templates={{ email: settings.invoiceEmailTemplate, whatsapp: settings.invoiceWhatsappTemplate, companyName: settings.companyName }}
          tdsPercent={client?.tdsPercent?.toNumber() ?? null}
          openTasks={openTasks}
        />
      ) : null}
    </div>
  );
}
