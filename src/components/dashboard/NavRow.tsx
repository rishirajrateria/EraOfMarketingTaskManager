"use client";
import { clsx } from "@/lib/clsx";
import { MeetIcon } from "@/components/dashboard/GoogleIcons";
import { FAB_TONE, type FabItem } from "@/components/dashboard/fab-model";

/**
 * A 64px bottom icon row (prototype `.navrow`): glass with a top hairline, the 52px blue square (+ / ×) pinned at the
 * far right in the same spot on every screen. Used by the add-task screen; the shell's bottom nav (GlobalNav) draws
 * the same geometry fixed to the bottom of every other screen.
 */
export function NavRow({ label, children, right }: { label: string; children: React.ReactNode; right: React.ReactNode }) {
  return (
    <nav aria-label={label} className="bar-glass flex h-16 shrink-0 items-center gap-1.5 border-t border-hair pl-1.5 pr-2.5">
      {children}
      {right}
    </nav>
  );
}

/** One icon + tiny label cell of a nav row (prototype `.nv`). */
export const navItemCls =
  "relative flex h-14 min-w-12 shrink-0 flex-col items-center justify-center gap-[3px] rounded-xl px-1 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]";
export const navLabCls = "whitespace-nowrap text-[10px] font-semibold leading-none";

/** One add shortcut in the add-task strip: a 32px coloured square over a tiny label. */
export function NavAddButton({ it, onPick }: { it: FabItem; onPick: (it: FabItem) => void }) {
  const Icon = it.icon;
  const name = `New ${it.label.toLowerCase()}`;
  return (
    <button type="button" onClick={() => onPick(it)} aria-label={name} title={name} className={navItemCls}>
      <span aria-hidden className={clsx("flex h-8 w-8 items-center justify-center rounded-[10px]", FAB_TONE[it.tone])}>
        {Icon ? <Icon size={18} strokeWidth={2.25} /> : <MeetIcon size={20} />}
      </span>
      <span aria-hidden className={clsx(navLabCls, "text-muted")}>{it.short}</span>
    </button>
  );
}
