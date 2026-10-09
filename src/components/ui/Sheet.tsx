"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "@/lib/clsx";

/**
 * Bottom sheet / full-screen sheet used for action menus and forms.
 * Portalled to <body>: `.phone-frame` and the glass cards use backdrop-filter, which would otherwise make the
 * fixed overlay size itself to that ancestor instead of the viewport (same reason as MenuTray).
 */
export function Sheet({
  open,
  onClose,
  children,
  full,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  full?: boolean;
  title?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 backdrop-blur-[2px]" onClick={onClose} role="dialog" aria-modal>
      <div
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "sheet-up glass-strong w-full max-w-[480px] overflow-y-auto shadow-2xl",
          full ? "h-[100dvh]" : "max-h-[85dvh] rounded-t-2xl",
        )}
      >
        {title ? (
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/60 bg-white/70 px-4 py-3 backdrop-blur-md">
            <h2 className="text-base font-semibold">{title}</h2>
            <button className="touch-target text-gray-500" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ActionList({ items }: { items: { label: string; onClick: () => void; danger?: boolean; hint?: string }[] }) {
  return (
    <ul className="divide-y divide-white/60">
      {items.map((it) => (
        <li key={it.label}>
          <button
            onClick={it.onClick}
            className={clsx("touch-target flex w-full items-center justify-between px-5 py-3 text-left text-sm", it.danger ? "text-red-600" : "text-gray-900")}
          >
            <span>{it.label}</span>
            {it.hint ? <span className="text-xs text-gray-400">{it.hint}</span> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
