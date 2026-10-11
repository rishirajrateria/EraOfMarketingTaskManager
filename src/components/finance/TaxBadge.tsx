import { clsx } from "@/lib/clsx";
import type { TaxResolution } from "@/server/finance/tax";
import { taxBadgeLabel } from "@/components/finance/invoice-form-helpers";

const TONE: Record<TaxResolution["taxMode"], string> = {
  CGST_SGST: "bg-sky-100/70 text-sky-900",
  IGST: "bg-indigo-100/70 text-indigo-900",
  EXPORT_LUT: "bg-teal-100/70 text-teal-900",
  NONE: "bg-violet-100/70 text-violet-900",
};

/** "Tax Invoice · CGST+SGST" style chip derived from `resolveTax`. */
export function TaxBadge({ tax, className }: { tax: TaxResolution; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full border border-white/60 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur-sm", TONE[tax.taxMode], className)} title={`Place of supply: ${tax.placeOfSupply}`}>
      {taxBadgeLabel(tax)}
    </span>
  );
}
