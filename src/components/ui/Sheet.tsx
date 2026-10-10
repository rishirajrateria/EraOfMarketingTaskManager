"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "@/lib/clsx";
import { useCornerClose } from "@/components/shell/corner-store";

/**
 * Bottom sheet / full-height sheet used for action menus and forms (glass refresh: 26px top radius, grab handle,
 * 18px title, 20px side padding = 4px here + the children's own 16px).
 * Portalled to <body>: `.phone-frame` and the glass cards use backdrop-filter, which would otherwise make the
 * fixed overlay size itself to that ancestor instead of the viewport (same reason as MenuTray).
 *
 * One close control (ADR 0016 addendum, prototype `.hasnav .dim` / `cornerMode`): the sheet and its dim stop above
 * the 64px bottom row (+ safe area) so the row's corner button stays visible — it turns into × while the sheet is open
 * and closes it (`onCornerClose`, default `onClose`). Sheets draw no ✕ of their own. Escape and a tap outside still
 * run `onClose`. Every sheet stops there, the full-screen add-task one included (the nav stays below it).
 */
export function Sheet({
  open,
  onClose,
  onCornerClose,
  children,
  full,
  title,
  minimised = false,
}: {
  open: boolean;
  /** Escape / tap outside (and the corner × unless `onCornerClose` says otherwise). */
  onClose: () => void;
  /** What the corner × does when it differs from `onClose` (the "+" list flow: × leaves, tap outside minimises). */
  onCornerClose?: () => void;
  children: React.ReactNode;
  full?: boolean;
  title?: string;
  /**
   * Kept mounted but hidden (the "+" flow's add form minimised to the bar above the bottom nav, ADR 0016 addendum):
   * what was typed survives until the bar expands it again.
   */
  minimised?: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const shown = open && !minimised;
  useCornerClose(onCornerClose ?? onClose, shown);
  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div
      hidden={minimised}
      // inside a sheet the page's sticky zones need no room for the nav (`.zone-sticky`)
      className="fixed inset-x-0 top-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-50 flex items-end justify-center bg-[rgba(2,12,24,.35)] backdrop-blur-[2px] [--gnav-h:0px] [--gnav-safe:0px]"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "sheet-up sheet-panel w-full max-w-[480px] overflow-y-auto text-ink",
          full ? "h-full" : "max-h-[min(88dvh,calc(100%-12px))] rounded-t-[26px] px-1 pb-3.5",
        )}
      >
        {full ? null : <div className="mx-auto mb-3 mt-2.5 h-[5px] w-10 rounded-full bg-muted opacity-35" aria-hidden />}
        {title ? (
          <div className={clsx("flex items-center gap-2 px-4", full ? "sticky top-0 z-10 border-b border-hair bg-sheet pb-3 pt-3 backdrop-blur-md" : "-mt-1 pb-2")}>
            <h2 className="text-[18px] font-bold tracking-[-.015em]">{title}</h2>
          </div>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** Glass action buttons (prototype `.al`): label 15px semibold, optional hint underneath. */
export function ActionList({ items }: { items: { label: string; onClick: () => void; danger?: boolean; hint?: string }[] }) {
  return (
    <ul className="flex flex-col gap-2 px-4 pb-4">
      {items.map((it) => (
        <li key={it.label}>
          <button
            onClick={it.onClick}
            className="touch-target flex w-full flex-col items-start gap-[3px] rounded-[14px] border border-hair bg-glass px-3.5 py-3 text-left backdrop-blur-[22px]"
          >
            <span className={clsx("text-[15px] font-semibold", it.danger ? "text-red-600" : "text-ink")}>{it.label}</span>
            {it.hint ? <span className="text-xs text-muted">{it.hint}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
