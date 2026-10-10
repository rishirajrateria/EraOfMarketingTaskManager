"use client";
import { clsx } from "@/lib/clsx";

/**
 * A 64px bottom row (prototype `.navrow`, nav v3): glass with a top hairline, a 3-column grid — two equal groups and
 * the 52px blue square (+ / ×) exactly centred between them, in the same spot on every screen. The shell's bottom nav
 * (GlobalNav, also below the add-task screen) uses it; callers set the height / position via `className`.
 */
export function NavRow({ label, left, center, right, className }: { label: string; left?: React.ReactNode; center: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <nav aria-label={label} className={clsx("bar-glass grid shrink-0 grid-cols-[minmax(0,1fr)_52px_minmax(0,1fr)] items-center gap-x-1 border-t border-hair px-1", className)}>
      <div className="flex min-w-0 items-center gap-0.5">{left}</div>
      <div className="flex items-center justify-center">{center}</div>
      <div className="flex min-w-0 items-center gap-0.5">{right}</div>
    </nav>
  );
}

/** One icon + tiny label cell of a nav row (prototype `.nv`). */
export const navItemCls =
  "relative flex h-14 min-w-12 shrink-0 flex-col items-center justify-center gap-[3px] rounded-xl text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]";
export const navLabCls = "whitespace-nowrap text-[10px] font-semibold leading-none";
