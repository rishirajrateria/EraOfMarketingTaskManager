"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Copies `text` to the clipboard and flashes a tick. */
export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="glass-chip inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium text-gray-800"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt("Copy this link", text);
        }
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copied" : label}
    </button>
  );
}
