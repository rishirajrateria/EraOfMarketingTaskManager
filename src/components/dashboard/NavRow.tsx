"use client";
import { clsx } from "@/lib/clsx";

/**
 * A 64px bottom row (prototype `.navrow`, nav v3 / v4): glass with a top hairline, a 3-column grid — two equal groups
 * and the 52px blue square (+ / ×) exactly centred between them, in the same spot on every screen. The shell's bottom
 * nav (GlobalNav, also below the add-task screen) uses it; callers set the height / position via `className`.
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

/**
 * One icon + tiny label cell of a nav row (prototype `.nv`, nav v4: `min-width:0; padding:0 1px`): the tabs share
 * their group's width evenly — three of them fit the ~146px a group gets at 360px beside the 52px +.
 */
export const navItemCls =
  "relative flex h-14 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-[3px] rounded-xl px-px text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]";
/** The 34×30 square behind the icon; the open tab tints it (`--nav-on-bg` / `--nav-on`). */
export const navIconCls = "flex h-[30px] w-[34px] shrink-0 items-center justify-center rounded-[10px]";
/**
 * The label (prototype `.nv .nlab`, nav v4): 9.5px semibold, centred, may wrap to two lines at a soft hyphen
 * (`navLabel`: "Notifi-cations"), `overflow-wrap: anywhere` as the fallback so nothing is ever clipped.
 */
export const navLabCls = "max-w-full whitespace-normal text-center text-[9.5px] font-semibold leading-[1.05] tracking-[-0.01em] [overflow-wrap:anywhere]";
