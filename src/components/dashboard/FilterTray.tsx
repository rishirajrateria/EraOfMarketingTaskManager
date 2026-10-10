"use client";
import { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { clsx } from "@/lib/clsx";

const key = (userId: string) => `eom:dash-tray-min:${userId}`;

/** Minimised or not, remembered per user in this browser (a convenience: falls back to expanded without storage). */
function useTrayMin(userId: string): [boolean, (min: boolean) => void] {
  const [min, setMin] = useState(false);
  useEffect(() => {
    try {
      setMin(window.localStorage.getItem(key(userId)) === "1");
    } catch {
      /* storage blocked: stay expanded */
    }
  }, [userId]);
  const set = useCallback(
    (next: boolean) => {
      setMin(next);
      try {
        if (next) window.localStorage.setItem(key(userId), "1");
        else window.localStorage.removeItem(key(userId));
      } catch {
        /* storage blocked: only this visit */
      }
    },
    [userId],
  );
  return [min, set];
}

/**
 * The dashboard's bottom filter tray (ADR 0016 addendum, prototype `#dashTray` / `.traytog`): the strip, the pill rows
 * and the time row, with a small glass tab centred on its top edge. Tapping the tab (chevron down) collapses the tray
 * to a slim 40px bar that only shows the tab — chevron up and "Filters · Social · Today" (`label`) — and the task list
 * gains the space; tapping it again expands. Remembered per user.
 */
export function FilterTray({ userId, label, children }: { userId: string; label: string; children: React.ReactNode }) {
  const [min, setMin] = useTrayMin(userId);
  const bodyId = useId();
  const name = min ? "Show filters" : "Hide filters";
  return (
    <section aria-label="Filters" data-tray={min ? "min" : "open"} className={clsx("relative shrink-0", min && "zone-top bar-glass h-10 border-t border-hair")}>
      <button
        type="button"
        onClick={() => setMin(!min)}
        aria-controls={bodyId}
        aria-expanded={!min}
        aria-label={min ? `${name} (${label})` : name}
        title={name}
        data-tray-toggle
        className={clsx(
          "glass-strong absolute left-1/2 z-[3] flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center justify-center gap-1.5 rounded-full text-[12px] font-semibold text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]",
          min ? "top-[7px] h-[26px] min-w-11 px-2.5" : "-top-[11px] h-[22px] min-w-10 px-2",
        )}
      >
        {min ? <ChevronUp size={16} strokeWidth={2.5} aria-hidden /> : <ChevronDown size={16} strokeWidth={2.5} aria-hidden />}
        {min ? (
          <span aria-hidden className="truncate">
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
