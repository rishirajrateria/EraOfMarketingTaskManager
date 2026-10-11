"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { TRAY_NAME, trayStorageKey, type TrayKind } from "@/components/dashboard/tray-key";

/** Minimised or not, remembered per user and tray in this browser (a convenience: falls back to expanded without storage). */
function useTrayMin(storageKey: string): [boolean, (min: boolean) => void] {
  const [min, setMin] = useState(false);
  useEffect(() => {
    try {
      setMin(window.localStorage.getItem(storageKey) === "1");
    } catch {
      /* storage blocked: stay expanded */
    }
  }, [storageKey]);
  const set = useCallback(
    (next: boolean) => {
      setMin(next);
      try {
        if (next) window.localStorage.setItem(storageKey, "1");
        else window.localStorage.removeItem(storageKey);
      } catch {
        /* storage blocked: only this visit */
      }
    },
    [storageKey],
  );
  return [min, set];
}

/**
 * A minimisable bottom tray (ADR 0016 addendum, prototype `.tray` / `.traytog`): its rows, with a small glass tab
 * centred on its top edge. Tapping the tab (chevron down) collapses the tray to a slim 40px bar that only shows the tab
 * — chevron up and the caption (`label`: "Filters · Social · Today", "Details · Social · Acme · Up next") — and the
 * screen above gains the space; tapping it again expands. A caption longer than the bar wraps (up to three lines at
 * 360px; the bar grows with it) rather than losing its end — for the add-task tray that end is the resolved start ("…
 * Mon 12 Oct - next free 10 am"), the one thing the minimised bar must still show. Remembered per user and per tray (`kind`,
 * tray-key). The task dashboard's filters (`FilterTray`), the add-task screen's details and the Admin dashboards'
 * filters share it. `className` positions it (default `relative`; the Admin dashboards pass `zone-sticky`, also a
 * positioned box).
 */
export function MinimisableTray({ kind, userId, label, className, children }: { kind: TrayKind; userId: string; label: string; className?: string; children: React.ReactNode }) {
  const [min, setMin] = useTrayMin(trayStorageKey(kind, userId));
  const bodyId = useId();
  const names = TRAY_NAME[kind];
  const name = min ? names.show : names.hide;
  return (
    <section
      aria-label={names.region}
      data-tray={min ? "min" : "open"}
      data-tray-kind={kind}
      className={clsx(className ?? "relative", "shrink-0", min && "zone-top bar-glass flex min-h-10 items-start justify-center border-t border-hair px-4 py-[7px]")}
    >
      <button
        type="button"
        onClick={() => setMin(!min)}
        aria-controls={bodyId}
        aria-expanded={!min}
        aria-label={min ? `${name} (${label})` : name}
        title={name}
        data-tray-toggle
        className={clsx(
          "glass-strong z-[3] flex items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]",
          min ? "relative min-h-[26px] min-w-11 max-w-full px-2.5 py-1" : "absolute -top-[11px] left-1/2 h-[22px] min-w-10 max-w-[calc(100%-32px)] -translate-x-1/2 px-2",
        )}
      >
        {min ? <ChevronUp size={16} strokeWidth={2.5} aria-hidden className="shrink-0" /> : <ChevronDown size={16} strokeWidth={2.5} aria-hidden />}
        {min ? (
          <span aria-hidden className="line-clamp-3 min-w-0 text-left leading-[16px] [overflow-wrap:anywhere]">
            {label}
          </span>
        ) : null}
      </button>
      <div id={bodyId} hidden={min}>
        {children}
      </div>
    </section>
  );
}

/**
 * The dashboard's bottom filter tray (prototype `#dashTray`): the strip, the pill rows and the time row; minimised it
 * reads "Filters · Social · Today".
 */
export function FilterTray({ userId, label, children }: { userId: string; label: string; children: React.ReactNode }) {
  return (
    <MinimisableTray kind="filters" userId={userId} label={label}>
      {children}
    </MinimisableTray>
  );
}
