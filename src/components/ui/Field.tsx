import { clsx } from "@/lib/clsx";

/** Labelled form field (glass refresh: 10.5px uppercase label, 0.07em tracking). */
export function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[.07em] text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[11.5px] leading-snug text-muted">{hint}</span> : null}
    </label>
  );
}

/** 44px input / select (textareas grow), 12px radius, sky focus ring. */
export const inputCls =
  "field-input w-full min-h-11 rounded-xl border border-hair bg-input px-3.5 py-2 text-[15px] text-ink shadow-[inset_0_1px_2px_rgba(15,40,70,.06)] placeholder:text-muted";
/** 46px primary button (ink in light, light in dark). */
export const btnPrimary =
  "touch-target inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-[14px] bg-primary px-4 text-[15px] font-semibold tracking-[-.01em] text-primary-ink shadow-[0_8px_20px_-10px_rgba(0,0,0,.45)] disabled:opacity-45";
export const btnSecondary =
  "touch-target inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-[14px] border border-hair bg-glass px-4 text-[15px] font-semibold text-ink shadow-glass backdrop-blur-[22px] disabled:opacity-45";
export const btnDanger =
  "touch-target inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-[14px] bg-gradient-to-b from-[#f87171] to-[#dc2626] px-4 text-[15px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(220,38,38,.6)] disabled:opacity-45";
