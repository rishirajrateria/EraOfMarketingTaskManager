import { formatINR } from "@/server/finance/money";
import type { TaxMode } from "@/server/finance/tax";
import type { InvoiceFormState } from "@/components/finance/invoice-form-helpers";
import { formTotals } from "@/components/finance/invoice-form-helpers";

/** Live totals (dark glass): taxable, CGST/SGST or IGST or "0% under LUT", total. */
export function TotalsCard({ form, taxMode, compact }: { form: Pick<InvoiceFormState, "useLines" | "lines" | "amount" | "gstPercent">; taxMode: TaxMode; compact?: boolean }) {
  const t = formTotals(form, taxMode);
  const Row = ({ k, v }: { k: string; v: string }) => (
    <div className="flex justify-between text-xs opacity-85">
      <span>{k}</span>
      <span>{v}</span>
    </div>
  );
  return (
    <div className={`glass-dark rounded-2xl px-4 text-white ${compact ? "py-2" : "py-3"}`}>
      <Row k="Taxable" v={formatINR(t.taxable)} />
      {taxMode === "CGST_SGST" ? (
        <>
          <Row k={`CGST ${t.gstPercent / 2}%`} v={formatINR(t.cgst)} />
          <Row k={`SGST ${t.gstPercent / 2}%`} v={formatINR(t.sgst)} />
        </>
      ) : taxMode === "IGST" ? (
        <Row k={`IGST ${t.gstPercent}%`} v={formatINR(t.igst)} />
      ) : taxMode === "EXPORT_LUT" ? (
        <Row k="GST · 0% under LUT" v={formatINR(0)} />
      ) : (
        <Row k="No tax (proforma)" v={formatINR(0)} />
      )}
      <div className="mt-1 flex justify-between text-base font-bold">
        <span>Total</span>
        <span>{formatINR(t.total)}</span>
      </div>
    </div>
  );
}
