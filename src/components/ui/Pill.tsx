"use client";
import { clsx } from "@/lib/clsx";

export function Pill({
  active,
  children,
  onClick,
  tone = "light",
  className,
  title,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  tone?: "light" | "dark" | "outline";
  className?: string;
  title?: string;
}) {
  const base = "no-select inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-medium leading-5 transition";
  const styles =
    tone === "light"
      ? active
        ? "bg-white/90 text-gray-900 shadow backdrop-blur-md"
        : "bg-white/25 text-white backdrop-blur-md hover:bg-white/35"
      : tone === "dark"
        ? active
          ? "bg-gray-900/90 text-white backdrop-blur-md"
          : "glass-chip text-gray-800"
        : active
          ? "border border-gray-900 bg-gray-900 text-white"
          : "glass-chip text-gray-700";
  return (
    <button type="button" title={title} onClick={onClick} className={clsx(base, styles, className)}>
      {children}
    </button>
  );
}
