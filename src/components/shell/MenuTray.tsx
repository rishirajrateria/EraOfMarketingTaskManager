"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Settings, X } from "lucide-react";
import { menuCounts, type MenuCounts } from "@/server/shell/menu";
import { filterSections, menuSections, softHyphenate, type BadgeTone, type MenuItem, type Tone } from "@/components/shell/menu-model";

/**
 * Admin menu (ADR 0011 v3 tiles): a thumb-first bottom sheet. Search on top, then square icon tiles grouped and
 * coloured by category (Money green, Clients blue, Team yellow, Other purple). The quick-actions row is gone (ADR 0016
 * addendum): the bottom nav and the + cover it. Portalled to <body> so blurred ancestors can never clip the overlay.
 */
const TONE: Record<Tone, string> = {
  money: "bg-[linear-gradient(150deg,#34d399,#059669)] text-white",
  client: "bg-[linear-gradient(150deg,#60a5fa,#2563eb)] text-white",
  team: "bg-[linear-gradient(150deg,#fcd34d,#f59e0b)] text-[#3b2a00]",
  other: "bg-[linear-gradient(150deg,#c4b5fd,#7c3aed)] text-white",
  red: "bg-[linear-gradient(150deg,#f87171,#dc2626)] text-white",
};
/** 8px dot before each section header. */
const DOT: Record<Tone, string> = { money: "bg-[#10b981]", client: "bg-[#3b82f6]", team: "bg-[#f59e0b]", other: "bg-[#8b5cf6]", red: "bg-[#ef4444]" };
/** Solid badges so they read on any tile colour (amber is orange so it shows on the yellow Team icons). */
const BADGE: Record<BadgeTone, string> = { red: "bg-[#ef4444] text-white", amber: "bg-[#ea580c] text-white", soft: "bg-[#2563eb] text-white" };
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]";


function Tile({ it, tone, onClose }: { it: MenuItem; tone: Tone; onClose: () => void }) {
  const Icon = it.icon;
  return (
    <Link
      href={it.href}
      onClick={onClose}
      title={it.sub ?? it.label}
      aria-label={it.label + (it.sub ? ` — ${it.sub}` : "")}
      className={`relative flex h-[104px] min-w-0 flex-col items-center justify-center gap-[7px] rounded-[18px] border border-hair bg-glass px-0.5 py-2 text-ink shadow-[var(--shadow)] transition-transform active:scale-[.97] ${FOCUS}`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] shadow-[0_6px_14px_-8px_rgba(0,0,0,.5)] ${TONE[it.danger ? "red" : tone]}`}>
        <Icon size={22} strokeWidth={2} />
      </span>
      <span
        aria-hidden
        className={`line-clamp-2 min-h-[2.4em] max-w-full text-center text-[12px] font-semibold leading-[1.2] tracking-[-.01em] hyphens-auto [overflow-wrap:anywhere] ${it.danger ? "text-[#dc2626] dark:text-[#f87171]" : ""}`}
      >
        {softHyphenate(it.label)}
      </span>
      {it.badge ? (
        <span
          aria-hidden
          className={`absolute right-1.5 top-1.5 inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px] text-[11.5px] font-bold shadow-[0_0_0_2px_var(--bg)] ${BADGE[it.badge.tone]}`}
        >
          {it.badge.n}
        </span>
      ) : null}
    </Link>
  );
}

export function MenuTray({ open, onClose, user }: { open: boolean; onClose: () => void; user?: { name: string } }) {
  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<MenuCounts | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    setQ("");
    let live = true;
    void menuCounts().then((r) => live && r.ok && setCounts(r.data));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sections = useMemo(() => filterSections(menuSections(counts), q), [counts, q]);

  if (!open || !mounted) return null;
  const name = user?.name || "Admin";
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(2,12,24,.38)] backdrop-blur-[3px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label="Admin menu"
        onClick={(e) => e.stopPropagation()}
        className="sheet-up flex max-h-[92dvh] w-full max-w-[480px] flex-col rounded-t-[28px] border border-b-0 border-hair bg-sheet text-ink shadow-[0_-24px_60px_-20px_rgba(0,0,0,.5)] backdrop-blur-[30px] backdrop-saturate-[1.8]"
      >
        <div className="mx-auto mb-1.5 mt-2.5 h-[5px] w-10 shrink-0 rounded-full bg-muted opacity-35" />
        <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-1.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[linear-gradient(150deg,#06b6d4,#2563eb)] text-[15px] font-extrabold text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,.6)]">{initials}</span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[17px] tracking-[-.015em]">{name}</b>
            <small className="block truncate text-[12px] text-muted">Admin{counts?.company ? ` · ${counts.company}` : ""}</small>
          </div>
          <Link href="/admin/settings" onClick={onClose} aria-label="Settings" className={`flex h-10 w-10 items-center justify-center rounded-xl border border-hair bg-chip ${FOCUS}`}>
            <Settings size={18} />
          </Link>
          <button type="button" onClick={onClose} aria-label="Close menu" className={`flex h-10 w-10 items-center justify-center rounded-xl border border-hair bg-chip ${FOCUS}`}>
            <X size={18} />
          </button>
        </div>
        <label className="mx-4 mb-2.5 flex h-11 shrink-0 items-center gap-2 rounded-[14px] border border-hair bg-input px-3.5 text-muted">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search menu" aria-label="Search menu" autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none" />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-[calc(10px+env(safe-area-inset-bottom))] pt-1">
          {sections.length === 0 ? <p className="py-7 text-center text-[13px] text-muted">Nothing matches “{q}”</p> : null}
          {sections.map((s) => (
            <section key={s.title} className="mb-3.5" aria-label={s.title}>
              <h5 className="mx-1 mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[.08em] text-muted">
                <span aria-hidden className={`h-2 w-2 rounded-[3px] ${DOT[s.tone]}`} />
                {s.title}
              </h5>
              <div className="grid grid-cols-4 gap-2 [@media(max-width:360px)]:grid-cols-3">
                {s.items.map((it) => (
                  <Tile key={it.href} it={it} tone={s.tone} onClose={onClose} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
