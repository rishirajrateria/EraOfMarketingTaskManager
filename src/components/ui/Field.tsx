import { clsx } from "@/lib/clsx";

export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-gray-400">{hint}</span> : null}
    </label>
  );
}

export const inputCls = "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-blue focus:outline-none";
export const btnPrimary = "touch-target rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
export const btnSecondary = "touch-target rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800";
export const btnDanger = "touch-target rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white";
