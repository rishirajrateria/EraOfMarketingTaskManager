"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { InvoiceWizard } from "@/components/finance/InvoiceWizard";
import { invoiceToForm, type DraftForEdit } from "@/components/finance/invoice-edit-helpers";
import type { ClientOpt, WizardEditInfo } from "@/components/finance/wizard/types";

type Props = WizardEditInfo & {
  inv: DraftForEdit;
  clients: ClientOpt[];
  companyStateCode: string | null;
  defaults: { gstPercent: number; paymentTerms: string };
  tz: string;
  /** Where to go after saving or closing: the invoice, the invoice with the approve sheet re-opened, or the list. */
  back: string;
};

/**
 * "Edit draft" (owner request): the invoice wizard in edit mode, pre-filled from the draft and opened at the Amount
 * step. Saving or closing returns to where the edit started (the Approve sheet re-opens with the new total).
 */
export function EditDraftScreen({ inv, clients, companyStateCode, defaults, tz, back, plans, partLabel }: Props) {
  const router = useRouter();
  // Built on the client: the reminder time is shown in the admin's own zone (like the create flow).
  const [initial] = useState(() => invoiceToForm(inv, { tz, defaultGst: defaults.gstPercent, paymentTerms: defaults.paymentTerms }));
  const leave = () => router.replace(back);
  return (
    <Sheet open full onClose={leave}>
      <InvoiceWizard clients={clients} companyStateCode={companyStateCode} defaults={defaults} onClose={leave} onSaved={leave} edit={{ id: inv.id, initial, plans, partLabel }} />
    </Sheet>
  );
}
