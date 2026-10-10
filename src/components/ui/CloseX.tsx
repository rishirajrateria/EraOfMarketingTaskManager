import { X } from "lucide-react";
import { clsx } from "@/lib/clsx";

/**
 * The "+ → ×" convention (ADR 0016 addendum, prototype `cancelX` / `.fx`): the dashboard's blue + opens things, and
 * the same 52px blue rounded-16 square, as an ×, closes them — always last, bottom-right.
 */
export const blueSquare =
  "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(150deg,#3b82f6,#1d4ed8)] text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,.7)] outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-45";

export function CloseX({ onClick, disabled, label = "Close", className }: { onClick: () => void; disabled?: boolean; label?: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className={clsx(blueSquare, className)}>
      <X size={24} strokeWidth={2.5} aria-hidden />
    </button>
  );
}

/**
 * Button row of a sheet form: the actions, the last of them (the primary) filling the row, then the blue × —
 * `[Deactivate] [Save ————] [×]`. Replaces a plain "Cancel" that only closes; destructive confirmations keep theirs.
 */
export function SheetButtons({ onClose, disabled, children, className }: { onClose: () => void; disabled?: boolean; children?: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("flex items-center gap-2", className)}>
      {children ? <div className="flex min-w-0 flex-1 items-center gap-2 [&>:last-child]:flex-1">{children}</div> : <span className="flex-1" />}
      <CloseX onClick={onClose} disabled={disabled} />
    </div>
  );
}
