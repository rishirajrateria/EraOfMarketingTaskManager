"use client";
import { useEffect } from "react";
import { clsx } from "@/lib/clsx";

/** Bottom sheet / full-screen sheet used for action menus and forms. */
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose} role="dialog" aria-modal>
      <div
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "sheet-up w-full max-w-[480px] overflow-y-auto bg-white shadow-2xl",
          full ? "h-[100dvh]" : "max-h-[85dvh] rounded-t-2xl",
        )}
      >
        {title ? (
          <div className="sticky top-0 flex items-center justify-between border-b bg-white px-4 py-3">
            <h2 className="text-base font-semibold">{title}</h2>
            <button className="touch-target text-gray-500" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export function ActionList({ items }: { items: { label: string; onClick: () => void; danger?: boolean; hint?: string }[] }) {
  return (
    <ul className="divide-y">
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
