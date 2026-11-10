import type { PartStatus } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireFinancePage } from "@/server/finance/guard";
import { getInvoiceDetail, listClientsForInvoice } from "@/server/finance/queries";
import { getSettings } from "@/lib/settings";
import { companyStateCode } from "@/server/finance/tax";
import { partPosition } from "@/server/finance/parts-core";
import { EditDraftScreen } from "@/components/finance/EditDraftScreen";
import { canEditDraft, type DraftForEdit } from "@/components/finance/invoice-edit-helpers";
import type { PlanKind } from "@/components/finance/finance-ui";

export const dynamic = "force-dynamic";

/** Where saving / closing returns to: `from=approve` re-opens the Approve sheet, `from=list` the invoice list. */
function backHref(id: string, from: string | undefined): string {
  if (from === "approve") return `/admin/invoices/${id}?approve=1`;
  if (from === "list") return "/admin/invoices";
  return `/admin/invoices/${id}`;
}

/** "Edit draft" (owner request): the invoice wizard in edit mode for an unapproved draft. ADMIN (finance write) only. */
export default async function EditDraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const user = await requireFinancePage();
  const { id } = await params;
  const back = backHref(id, (await searchParams).from);
  if (!user.canWrite) redirect(`/admin/invoices/${id}`);
  const inv = await getInvoiceDetail(id);
  if (!inv) notFound();
  if (!canEditDraft(inv)) redirect(`/admin/invoices/${id}`);
  const [clients, settings, row] = await Promise.all([listClientsForInvoice(), getSettings(), prisma.invoice.findUnique({ where: { id }, select: { scheduleId: true } })]);
  const seriesRuns = row?.scheduleId ? (await prisma.invoice.count({ where: { scheduleId: row.scheduleId, id: { not: id } } })) > 0 : false;
  const plans: PlanKind[] = inv.plan === "PART" ? ["PART"] : seriesRuns ? ["RECURRING"] : ["ONE_TIME", "RECURRING"];
  const pos = inv.planRef && inv.partSeq != null ? partPosition(inv.planRef.parts.map((p) => ({ seq: p.seq, status: p.status as PartStatus })), inv.partSeq) : null;
  const draft: DraftForEdit = {
    id: inv.id,
    status: inv.status,
    approvedAt: inv.approvedAt,
    number: inv.number,
    clientId: inv.clientId,
    docType: inv.docType,
    taxMode: inv.taxMode,
    plan: inv.plan,
    description: inv.description,
    gstPercent: inv.gstPercent,
    tdsApplicable: inv.tdsApplicable,
    currency: inv.currency,
    dueDate: inv.dueDate,
    remindAt: inv.remindAt,
    notes: inv.notes,
    paymentTerms: inv.paymentTerms,
    createdAt: inv.createdAt,
    items: inv.items.map(({ description, hsnSac, qty, unit, rate, amount }) => ({ description, hsnSac, qty, unit, rate, amount })),
    schedule: inv.schedule,
    planRef: inv.planRef ? { gstPercent: inv.planRef.gstPercent } : null,
  };
  // Clients that were deactivated still show when the draft is theirs.
  const options = clients.some((c) => c.id === inv.clientId) ? clients : [...clients, ...(await listClientById(inv.clientId))];
  return (
    <EditDraftScreen
      inv={draft}
      clients={options}
      companyStateCode={companyStateCode(settings)}
      defaults={{ gstPercent: settings.defaultGstPercent.toNumber(), paymentTerms: settings.invoiceTerms }}
      tz={settings.timezone}
      back={back}
      plans={plans}
      partLabel={pos ? `Part ${pos.index} of ${pos.count}` : null}
    />
  );
}

async function listClientById(id: string) {
  const c = await prisma.client.findUnique({ where: { id }, select: { id: true, name: true, email: true, whatsapp: true, country: true, currency: true, stateCode: true, stateName: true, gstNumber: true, tdsPercent: true, workOnHold: true } });
  return c ? [{ ...c, tdsPercent: c.tdsPercent?.toNumber() ?? null }] : [];
}
