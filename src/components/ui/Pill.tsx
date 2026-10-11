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
        ? "bg-white/90 text-[#0b1b2b] shadow backdrop-blur-md"
        : "bg-white/25 text-white backdrop-blur-md hover:bg-white/35"
      : tone === "dark"
        ? active
          ? "bg-primary text-primary-ink"
          : "glass-chip text-ink"
        : active
          ? "border border-transparent bg-primary text-primary-ink"
          : "glass-chip text-ink";
  return (
    <button type="button" title={title} onClick={onClick} className={clsx(base, styles, className)}>
      {children}
    </button>
  );
}
