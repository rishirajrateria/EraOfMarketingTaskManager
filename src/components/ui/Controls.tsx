"use client";
import { clsx } from "@/lib/clsx";

/** Small shared controls from the glass refresh (ADR 0010). Selected states use the primary token in both themes. */

/** Segmented / pill button, 34px. */
export function SegButton({ on, onClick, children, label, className }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={clsx(
        "no-select h-[34px] shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[12.5px] font-medium transition",
        on ? "border-transparent bg-primary text-primary-ink" : "border-hair bg-chip text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Small chip-style pill (26px), e.g. "★ Important", "½h". */
export function ChipButton({ on, onClick, children, label, onClass, className }: { on?: boolean; onClick: () => void; children: React.ReactNode; label?: string; onClass?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={clsx(
        "no-select inline-flex h-[26px] shrink-0 items-center whitespace-nowrap rounded-full border px-[11px] text-[11.5px] font-medium backdrop-blur-[10px] transition",
        on ? (onClass ?? "border-transparent bg-primary text-primary-ink") : "border-hair bg-chip text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** − value + stepper (34px). */
export function Stepper({ onMinus, onPlus, children, minusLabel = "less", plusLabel = "more", valueClass }: { onMinus: () => void; onPlus: () => void; children: React.ReactNode; minusLabel?: string; plusLabel?: string; valueClass?: string }) {
  return (
    <div className="flex h-[34px] w-max items-center rounded-full border border-hair bg-chip text-ink">
      <button type="button" aria-label={minusLabel} onClick={onMinus} className="h-[34px] w-[34px] text-lg leading-none">
        −
      </button>
      <b className={clsx("min-w-[46px] text-center text-[13px]", valueClass)}>{children}</b>
      <button type="button" aria-label={plusLabel} onClick={onPlus} className="h-[34px] w-[34px] text-lg leading-none">
        +
      </button>
    </div>
  );
}

/** Uppercase muted group label ("Quick pick", "Ends"). */
export function GroupLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("mb-1.5 text-[11px] font-bold uppercase tracking-[.04em] text-muted", className)}>{children}</div>;
}
