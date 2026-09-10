"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { clsx } from "@/lib/clsx";
import { useToast } from "@/components/ui/Toast";
import { btnPrimary, btnSecondary } from "@/components/ui/Field";

/** Shared client-side building blocks for the admin screens (list + "＋" FAB + Sheet form). */

/** Runs a server action, toasts the result and refreshes the RSC tree on success. */
export function useAdminAction() {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(action: Promise<ActionResult<T>>, successText: string): Promise<T | null> => {
      setBusy(true);
      try {
        const res = await action;
        if (!res.ok) {
          toast(res.error, "err");
          return null;
        }
        toast(successText);
        router.refresh();
        return res.data;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Something went wrong", "err");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [router, toast],
  );
  return { busy, run };
}

/** Floating "＋" button pinned to the bottom-right of the phone frame. */
export function Fab({ onClick, label = "Add" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="fixed bottom-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-brand-green text-3xl leading-none text-white shadow-lg active:bg-brand-green-dark"
      style={{ right: "max(1rem, calc(50% - 240px + 1rem))" }}
    >
      ＋
    </button>
  );
}

export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="bg-brand-blue px-4 pb-4 pt-3 text-white">
      <h1 className="text-lg font-bold">{title}</h1>
      {subtitle ? <p className="text-xs text-white/80">{subtitle}</p> : null}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-gray-500">{children}</h2>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-gray-400">{children}</p>;
}

/** Tappable list row. */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  inactive,
  onClick,
}: {
  title: string;
  subtitle?: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  inactive?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex w-full items-center gap-3 border-b border-gray-100 bg-white px-4 py-3 text-left",
        inactive && "opacity-60",
        onClick && "active:bg-gray-50",
      )}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-gray-900">{title}</span>
        {subtitle ? <span className="block truncate text-xs text-gray-500">{subtitle}</span> : null}
      </span>
      {trailing}
    </button>
  );
}

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={clsx("rounded-full px-2 py-0.5 text-[10px] font-semibold", active ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600")}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export function ColourDot({ colour, size = 12 }: { colour: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ background: colour, width: size, height: size }} />;
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2">
      <span>
        <span className="block text-sm text-gray-900">{label}</span>
        {hint ? <span className="block text-[11px] text-gray-400">{hint}</span> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-brand-blue" />
    </label>
  );
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function WeekdayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  const toggle = (d: number) => onChange(value.includes(d) ? value.filter((x) => x !== d) : [...value, d].sort((a, b) => a - b));
  return (
    <div className="flex flex-wrap gap-1.5">
      {WEEKDAYS.map((name, d) => (
        <label
          key={name}
          className={clsx(
            "cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium",
            value.includes(d) ? "border-brand-blue bg-brand-blue text-white" : "border-gray-300 bg-white text-gray-700",
          )}
        >
          <input type="checkbox" className="sr-only" checked={value.includes(d)} onChange={() => toggle(d)} />
          {name}
        </label>
      ))}
    </div>
  );
}

export function ColourInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded border border-gray-300 bg-white p-0.5" />
      <span className="font-mono text-xs text-gray-500">{value}</span>
    </div>
  );
}

/** Sticky submit/cancel footer used inside form Sheets. */
export function FormFooter({ busy, onCancel, submitLabel = "Save", extra }: { busy: boolean; onCancel: () => void; submitLabel?: string; extra?: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 flex items-center gap-2 border-t bg-white px-4 py-3">
      {extra}
      <span className="flex-1" />
      <button type="button" className={btnSecondary} onClick={onCancel} disabled={busy}>
        Cancel
      </button>
      <button type="submit" className={btnPrimary} disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}

export const hoursToMinutes = (hours: string): number | null => {
  const h = Number(hours);
  return hours.trim() === "" || Number.isNaN(h) ? null : Math.round(h * 60);
};
export const minutesToHours = (min: number | null | undefined): string => (min == null ? "" : String(Math.round((min / 60) * 100) / 100));
