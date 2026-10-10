"use client";
import { Menu } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { menuStore } from "@/components/shell/menu-store";

/**
 * Thumb-reach zone shared by every screen (same geometry as the dashboard, SPEC §5.4):
 * optional glass strip · emerald area with pill rows (40px each, 28px pills) · 56px bar split 62% green / 38% glass.
 * The zone's top edge has a 22px radius (glass refresh, ADR 0010).
 * Put a screen's tabs, filters and primary actions here, never in the header.
 */
export function ZonePill({ active, onClick, children, label, className }: { active?: boolean; onClick?: () => void; children: React.ReactNode; label?: string; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={clsx(
        "no-select flex h-7 shrink-0 items-center whitespace-nowrap rounded-full px-[13px] text-xs font-medium leading-none transition",
        active ? "bg-green-pill-on" : "bg-green-pill",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ZoneRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="scrollbar-none flex h-10 items-center gap-2 overflow-x-auto px-3" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** Chip for the white part of the bar (like the dashboard's "Work"). */
export function BarChip({ onClick, children, label, active, className }: { onClick?: () => void; children: React.ReactNode; label?: string; active?: boolean; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={clsx("no-select glass-chip flex h-[30px] items-center whitespace-nowrap rounded-full px-3.5 text-xs font-semibold leading-none text-ink", active && "ring-1 ring-ink/50", className)}
    >
      {children}
    </button>
  );
}

/** 44px icon button for the bar (white glyph on green, dark glyph on white). */
export function BarIcon({ onClick, label, children, tone = "green", href }: { onClick?: () => void; label: string; children: React.ReactNode; tone?: "green" | "white"; href?: string }) {
  const cls = clsx("touch-target flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", tone === "green" ? "text-white" : "text-ink");
  if (href) {
    return (
      <a href={href} aria-label={label} title={label} className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={cls}>
      {children}
    </button>
  );
}

export function BottomZone({
  strip,
  rows,
  left,
  right,
  menu = true,
  actions,
  className,
}: {
  /** a form's button row (`SheetButtons`: `[Back] [Next ———]`; the bottom nav's corner × closes) in place of the green / glass bar */
  actions?: React.ReactNode;
  /** optional white strip above the green area (like the dashboard filter strip) */
  strip?: React.ReactNode;
  /** green pill rows (each should be a <ZoneRow>) */
  rows?: React.ReactNode;
  /** contents of the green 62% part of the bar (after the ☰) */
  left?: React.ReactNode;
  /** contents of the white 38% part of the bar (primary actions) */
  right?: React.ReactNode;
  /** show the ☰ menu button (Admin screens) */
  menu?: boolean;
  className?: string;
}) {
  return (
    <div className={clsx("zone-top zone-sticky z-20 shrink-0", className)}>
      {strip ? <div className="strip-glass flex h-11 items-center gap-1.5 px-3">{strip}</div> : null}
      {rows ? <div className="bg-green-area">{rows}</div> : null}
      {actions ? (
        <div className="bar-glass border-t border-hair px-3 pb-3 pt-2">{actions}</div>
      ) : (
        <div className="flex h-14 items-stretch">
          <div className="scrollbar-none flex min-w-0 flex-[62] items-center gap-2 overflow-x-auto bg-green-bar pr-2">
            {menu ? (
              <BarIcon label="Menu" onClick={() => menuStore.open()}>
                <Menu size={22} />
              </BarIcon>
            ) : (
              <span className="w-2.5" />
            )}
            {left}
          </div>
          <div className="bar-glass flex flex-[38] items-center justify-evenly gap-1 px-1">{right}</div>
        </div>
      )}
    </div>
  );
}
