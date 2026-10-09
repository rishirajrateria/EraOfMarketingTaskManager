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

export const inputCls = "w-full rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,.8)] backdrop-blur-md focus:border-brand-blue/60 focus:bg-white/80 focus:outline-none";
export const btnPrimary = "touch-target rounded-xl bg-gradient-to-b from-[#2f74e6] to-[#1e63d6] px-4 py-2 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(30,99,214,.35),inset_0_1px_0_rgba(255,255,255,.35)] disabled:opacity-50";
export const btnSecondary = "touch-target glass-chip rounded-xl px-4 py-2 text-sm font-medium text-gray-800";
export const btnDanger = "touch-target rounded-xl bg-gradient-to-b from-[#ef4444] to-[#dc2626] px-4 py-2 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(220,38,38,.3),inset_0_1px_0_rgba(255,255,255,.3)]";
