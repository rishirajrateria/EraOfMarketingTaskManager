import type { listClientsForInvoice } from "@/server/finance/queries";
import type { InvoiceFormState } from "@/components/finance/invoice-form-helpers";
import type { TaxResolution } from "@/server/finance/tax";
import type { PlanKind } from "@/components/finance/finance-ui";

export type ClientOpt = Awaited<ReturnType<typeof listClientsForInvoice>>[number];

export type StepProps = {
  form: InvoiceFormState;
  set: (patch: Partial<InvoiceFormState>) => void;
  errors: Record<string, string>;
  clients: ClientOpt[];
  tax: TaxResolution | null;
  /** Set when the wizard edits an existing draft ("Edit draft"). */
  edit?: WizardEditInfo | null;
};

/**
 * Edit mode: which plans the draft may switch to (a part-payment draft stays a part; one occurrence of a running
 * recurring series stays recurring; otherwise one time <-> recurring) and the part's label ("Part 1 of 2").
 */
export type WizardEditInfo = { plans: PlanKind[]; partLabel: string | null };

export const STEP_FIELDS: Record<number, string[]> = {
  1: ["clientId"],
  2: ["amount", "items", "description"],
  3: ["recurrence", "parts", "dueDate"],
  4: [],
};

export function FieldError({ error }: { error?: string }) {
  return error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null;
}
