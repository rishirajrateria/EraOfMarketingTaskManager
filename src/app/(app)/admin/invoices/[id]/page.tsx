import Link from "next/link";
import { notFound } from "next/navigation";
import { canEditDraft } from "@/components/finance/invoice-edit-helpers";
import { prisma } from "@/lib/db";
import { requireFinancePage } from "@/server/finance/guard";
import { getInvoiceDetail } from "@/server/finance/queries";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { peekNextNumber } from "@/server/finance/numbering";
import { InvoiceActions } from "@/components/finance/InvoiceActions";
import { ScheduleBlock } from "@/components/finance/ScheduleBlock";
import { AmountsBlock, ClientBlock, DetailHeader, NotesBlock, PaymentsBlock, RelatedDocsBlock, SendStateBlock } from "@/components/finance/InvoiceDetailSections";

export const dynamic = "force-dynamic";
const OPEN_TASKS = ["ASSIGNED", "STARTED", "FINISH_REQUESTED"] as const;

/** Invoice detail (ADR 0005): header, amounts, client, schedule, approval + delivery, related docs, payments, actions. */
export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ approve?: string }> }) {
  const user = await requireFinancePage();
  const { id } = await params;
  const autoApprove = (await searchParams).approve === "1";
  const [inv, settings] = await Promise.all([getInvoiceDetail(id), getSettings()]);
  if (!inv) notFound();
  const [client, openTasks, nextNumber] = await Promise.all([
    prisma.client.findUnique({ where: { id: inv.clientId }, select: { tdsPercent: true } }),
    prisma.task.count({ where: { clientId: inv.clientId, deletedAt: null, status: { in: [...OPEN_TASKS] } } }),
    peekNextNumber(inv.docType === "PROFORMA" || inv.docType === "CREDIT_NOTE" ? "TAX_INVOICE" : inv.docType),
  ]);
  const tz = settings.timezone;
  return (
    <div className="flex flex-1 flex-col">
      <DetailHeader inv={inv} tz={tz} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-4 pt-3">
        {inv.status === "AWAITING_APPROVAL" ? (
          <div role="status" className="mx-4 mb-3 rounded-xl border border-white/60 bg-amber-100/70 px-3 py-2 text-sm text-amber-900 backdrop-blur-sm">
            <b>Awaiting your approval.</b> Nothing has been sent. Review, then tap <b>Approve &amp; send</b> below to allocate the number and deliver it.
            {user.canWrite && canEditDraft(inv) ? (
              <Link href={`/admin/invoices/${inv.id}/edit`} className="mt-2 flex w-fit items-center gap-1 rounded-full border border-amber-900/20 bg-white/70 px-3 py-1.5 text-xs font-semibold text-amber-950 dark:bg-white/10 dark:text-amber-100">
                ✎ Edit draft
              </Link>
            ) : null}
          </div>
        ) : null}
        {inv.docType === "PROFORMA" ? (
          <div role="note" className="mx-4 mb-3 rounded-xl border border-hair bg-violet-100/70 px-3 py-2 text-sm text-violet-950 backdrop-blur-sm dark:bg-violet-500/15 dark:text-violet-100">
            <b className="block">Proforma · for reference only</b>
            <div className="text-xs">
              It can&apos;t be cancelled and no record is kept: it never counts in sales, outstanding or GST, isn&apos;t filed in the monthly Drive folders and never takes a tax invoice number (the EOM-PRO number is only a reference). {inv.convertedTo ? "It was converted into a tax invoice." : "Delete it when you no longer need it, or convert it into a tax invoice."}
            </div>
          </div>
        ) : null}
        {inv.status === "CANCELLED" && inv.cancelReason ? (
          <div role="status" className="mx-4 mb-3 rounded-xl border border-white/60 bg-red-100/75 px-3 py-2 text-sm text-red-900 backdrop-blur-sm">
            <b className="block">Cancelled on {fmtDate(new Date(inv.cancelledAt ?? inv.createdAt), tz, "dd MMM yyyy")}</b>
            <div>Reason: {inv.cancelReason}</div>
            <div className="mt-1 text-xs text-red-800/90">
              Number {inv.number} stays used and is never given to another invoice. Filed in Drive › Finance › {fmtDate(new Date(inv.approvedAt ?? inv.cancelledAt ?? inv.createdAt), tz, "yyyy-MM")} › Cancelled invoices.
            </div>
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
          nextNumber={nextNumber}
          autoApprove={autoApprove}
        />
      ) : null}
    </div>
  );
}
