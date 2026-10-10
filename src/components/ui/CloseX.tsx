import { clsx } from "@/lib/clsx";

/**
 * The "+ → ×" convention (ADR 0016 addendum, prototype `cornerTap` / `.fx`): one 52px blue rounded-16 square in the
 * middle of the bottom nav. It is the + that turns into × while something is open (AddSpeedDial + corner-store) —
 * the add-task screen included, which sits above the nav like every sheet.
 */
export const blueSquare =
  "flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(150deg,#3b82f6,#1d4ed8)] text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,.7)] outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-45";

/**
 * Button row of a sheet or form page: its actions only, the last of them (the primary) filling the row —
 * `[Deactivate] [Save ————]`, `[Back] [Next ————]`. Closing is the bottom row's corner × (ADR 0016 addendum: one close
 * control), so forms no longer draw their own ×. Destructive confirmations keep their Keep / Delete pair.
 */
export function SheetButtons({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("flex items-center gap-2 [&>:last-child]:flex-1", className)}>{children}</div>;
}
