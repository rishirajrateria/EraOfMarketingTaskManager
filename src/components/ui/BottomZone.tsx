"use client";
import { Menu } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { menuStore } from "@/components/shell/menu-store";

/**
 * Thumb-reach zone shared by every screen (same geometry as the dashboard, SPEC §5.4):
 * optional white strip · green area with pill rows (34px each) · 44px bar split 62% green / 38% white.
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
        "no-select flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[11px] leading-none text-[#111] transition",
        active ? "bg-white/90 shadow-sm backdrop-blur-md" : "bg-green-pill",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function ZoneRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="scrollbar-none flex h-[34px] items-center gap-1.5 overflow-x-auto px-2.5" role="group" aria-label={label}>
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
      className={clsx("no-select glass-chip flex h-[22px] items-center whitespace-nowrap rounded-full px-3 text-[11px] leading-none text-[#111]", active && "ring-1 ring-[#111]/60", className)}
    >
      {children}
    </button>
  );
}

/** 44px icon button for the bar (white glyph on green, dark glyph on white). */
export function BarIcon({ onClick, label, children, tone = "green", href }: { onClick?: () => void; label: string; children: React.ReactNode; tone?: "green" | "white"; href?: string }) {
  const cls = clsx("touch-target flex h-11 w-11 shrink-0 items-center justify-center", tone === "green" ? "text-white" : "text-[#111]");
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
  className,
}: {
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
    <div className={clsx("sticky bottom-0 z-20 shrink-0", className)}>
      {strip ? <div className="flex h-10 items-center gap-1.5 border-t border-white/70 bg-white/55 px-2.5 backdrop-blur-xl">{strip}</div> : null}
      {rows ? <div className="bg-green-area">{rows}</div> : null}
      <div className="flex h-11 items-stretch">
        <div className="scrollbar-none flex min-w-0 flex-[62] items-center gap-1.5 overflow-x-auto bg-green-bar pr-2">
          {menu ? (
            <BarIcon label="Menu" onClick={() => menuStore.open()}>
              <Menu size={22} />
            </BarIcon>
          ) : (
            <span className="w-2.5" />
          )}
          {left}
        </div>
        <div className="flex flex-[38] items-center justify-evenly gap-1 bg-white/60 px-1 backdrop-blur-xl">{right}</div>
      </div>
    </div>
  );
}
