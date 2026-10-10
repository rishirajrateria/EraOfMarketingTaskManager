"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { clsx } from "@/lib/clsx";
import { useToast } from "@/components/ui/Toast";
import { btnPrimary } from "@/components/ui/Field";
import { SheetButtons } from "@/components/ui/CloseX";

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

/**
 * Thumb-reach page layout (SPEC §5.4): header (shrink-0) · scrolling content (flex-1) · BottomZone (sticky bottom-0).
 * `zone` should be a <BottomZone>; it sits after the content so the last rows are never covered.
 */
export function Screen({ header, zone, children, className }: { header?: React.ReactNode; zone?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header ? <div className="shrink-0">{header}</div> : null}
      <div className={clsx("min-h-0 flex-1 overflow-y-auto", className)}>{children}</div>
      {zone}
    </div>
  );
}

/** Compact prev · label · next control for the green part of the bottom bar (month / period navigation). */
export function PeriodNav({ label, prevLabel, nextLabel, onPrev, onNext }: { label: string; prevLabel: string; nextLabel: string; onPrev: () => void; onNext: () => void }) {
  const btn = "flex h-11 w-7 shrink-0 items-center justify-center text-white";
  return (
    <>
      <button type="button" onClick={onPrev} aria-label={prevLabel} title={prevLabel} className={btn}>
        <ChevronLeft size={22} />
      </button>
      <span className="no-select bg-green-pill-on inline-block h-7 max-w-[6.5rem] shrink-0 truncate rounded-full px-2.5 text-xs font-semibold leading-[26px]" title={label}>
        {label}
      </span>
      <button type="button" onClick={onNext} aria-label={nextLabel} title={nextLabel} className={btn}>
        <ChevronRight size={22} />
      </button>
    </>
  );
}

/** Floating "＋" button pinned to the bottom-right of the phone frame. Kept for ad-hoc use; screens now put "+ Add" in the BottomZone. */
export function Fab({ onClick, label = "Add" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="fixed bottom-6 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-b from-[#10b981] to-[#059669] text-3xl leading-none text-white shadow-[0_8px_20px_rgba(5,150,105,.4),inset_0_1px_0_rgba(255,255,255,.35)]"
      style={{ right: "max(1rem, calc(50% - 240px + 1rem))" }}
    >
      ＋
    </button>
  );
}

export function ScreenHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="px-4 pb-1 pt-4 text-ink">
      <h1 className="text-[17px] font-bold tracking-[-.015em]">{title}</h1>
      {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="px-4 pb-2 pt-4 text-[10.5px] font-bold uppercase tracking-[.07em] text-muted">{children}</h2>;
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="mx-2.5 my-4 rounded-2xl border border-dashed border-hair bg-glass px-5 py-10 text-center text-[13px] text-muted">{children}</p>;
}

/** Tappable list row: a floating glass card (12px side margin, 8px gap, 16px radius, 14×16 padding). */
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
        "glass-card mx-3 mb-2 flex w-[calc(100%-24px)] items-center gap-3 px-4 py-3.5 text-left first:mt-3",
        inactive && "opacity-60",
        onClick && "active:scale-[.995]",
      )}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink">{title}</span>
        {subtitle ? <span className="mt-0.5 block truncate text-xs text-muted">{subtitle}</span> : null}
      </span>
      {trailing}
    </button>
  );
}

export function StatusPill({ active }: { active: boolean }) {
  return (
    <span className={clsx("inline-flex h-[22px] items-center rounded-full border px-[9px] text-[10.5px] font-semibold", active ? "border-hair bg-[rgba(16,185,129,.16)] text-[#059669]" : "glass-chip text-muted")}>
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
        <span className="block text-sm text-ink">{label}</span>
        {hint ? <span className="block text-[11.5px] text-muted">{hint}</span> : null}
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
            "flex h-[34px] cursor-pointer items-center rounded-full border px-3 text-xs font-medium",
            value.includes(d) ? "border-transparent bg-primary text-primary-ink" : "glass-chip text-ink",
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
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 cursor-pointer rounded-lg border border-hair bg-input p-0.5" />
      <span className="font-mono text-xs text-muted">{value}</span>
    </div>
  );
}

/**
 * Sticky footer of the form Sheets: `[extra] [Save ————]`. Closing is the bottom row's corner × (one close control,
 * ADR 0016 addendum), so the form draws no × of its own.
 */
export function FormFooter({ busy, submitLabel = "Save", extra }: { busy: boolean; submitLabel?: string; extra?: React.ReactNode }) {
  return (
    <SheetButtons className="sticky bottom-0 -mx-4 px-4 py-3 backdrop-blur-xl">
      {extra}
      <button type="submit" className={btnPrimary} disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </SheetButtons>
  );
}

export const hoursToMinutes = (hours: string): number | null => {
  const h = Number(hours);
  return hours.trim() === "" || Number.isNaN(h) ? null : Math.round(h * 60);
};
export const minutesToHours = (min: number | null | undefined): string => (min == null ? "" : String(Math.round((min / 60) * 100) / 100));

/** Multi-select pill picker used for Teams (Add Work) and Speciality (Add Executive / Team Leader). */
export function PillPicker({ options, value, onChange, empty }: { options: { id: string; name: string }[]; value: string[]; onChange: (ids: string[]) => void; empty?: React.ReactNode }) {
  if (!options.length) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o.id) : [...value, o.id])}
            className={clsx("h-[34px] rounded-full border px-3.5 text-[12.5px] font-medium transition", on ? "border-transparent bg-primary text-primary-ink" : "border-hair bg-chip text-ink")}
          >
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

/** Small trailing "edit" pill on tappable admin rows. */
export function EditPill() {
  return <span className="glass-chip inline-flex h-[23px] shrink-0 items-center rounded-full px-[9px] text-[11px] font-medium text-ink">edit</span>;
}
