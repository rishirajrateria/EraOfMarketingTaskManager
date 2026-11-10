"use client";
import { useEffect, useRef } from "react";
import { clsx } from "@/lib/clsx";

/**
 * Neutral glass one-tap filter rows (prototype `prow` / `.dk` / `.plab`, ADR 0015), shared by the task dashboard's
 * bottom zone and the Admin dashboards / requests inbox (ADR 0016).
 */

/** A one-tap filter pill (prototype `.dk`): single line; dark filled when on. `dense` = 30px for stacked rows. */
export function DockPill({ on, onClick, label, dense, children }: { on: boolean; onClick: () => void; label?: string; dense?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx(
        "no-select flex shrink-0 items-center gap-1 whitespace-nowrap border font-semibold",
        dense ? "h-[30px] rounded-[11px] px-2.5 text-[12px]" : "h-8 rounded-[12px] px-2.5 text-[12.5px]",
        on ? "border-transparent bg-primary text-primary-ink" : "glass-chip border-hair text-ink",
      )}
    >
      {children}
    </button>
  );
}

export type FilterItem = { id: string; label: React.ReactNode; aria?: string };

/**
 * A filter row: small uppercase muted label, optional "All", then one pill per item — scrolls sideways, never wraps.
 * With "All", tapping the picked pill again clears it; without, the row is a single choice (VIEW, WHEN).
 */
export function FilterRow({
  label,
  items,
  value,
  onChange,
  all = true,
  dense,
}: {
  label: string;
  items: FilterItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  all?: boolean;
  dense?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  // Keep the picked pill in view when the row scrolls sideways (e.g. a deep link to the last pill).
  useEffect(() => {
    const el = strip.current;
    const on = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !on) return;
    const right = on.offsetLeft + on.offsetWidth - el.clientWidth + 12;
    if (on.offsetLeft < el.scrollLeft || right > el.scrollLeft) el.scrollLeft = Math.max(0, Math.min(on.offsetLeft - 12, right));
  }, [value]);
  return (
    <div className={clsx("flex items-center", dense ? "h-[38px]" : "h-[42px]")} role="group" aria-label={label}>
      <span className={clsx("shrink-0 pl-3 font-extrabold uppercase tracking-[.07em] text-muted", dense ? "w-[74px] text-[10px]" : "w-[78px] text-[10.5px]")}>{label}</span>
      <div ref={strip} className="scrollbar-none relative flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-3">
        {all ? (
          <DockPill dense={dense} on={value === null} onClick={() => onChange(null)}>
            All
          </DockPill>
        ) : null}
        {items.map((it) => (
          <DockPill key={it.id} dense={dense} label={it.aria} on={value === it.id} onClick={() => onChange(all && value === it.id ? null : it.id)}>
            {it.label}
          </DockPill>
        ))}
      </div>
    </div>
  );
}
