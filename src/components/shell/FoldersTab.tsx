"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { Folder, HardDrive, type LucideIcon } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { navIconCls, navItemCls, navLabCls } from "@/components/dashboard/NavRow";
import { FOLDER_LINKS, navLabel, type FolderLink } from "@/components/shell/nav-model";

const MENU_ID = "folders-menu";
/** Clearance from the nav's edges (prototype: the phone frame ± 8px). */
const EDGE = 8;
/** The popover's bottom sits 2px above the nav's top edge (prototype `.navpop{bottom:62px}` on the 56px tab). */
const LIFT = 2;
/** Tones = the menu's Money green and Clients blue (`MenuTray` TONE). */
const TONE: Record<FolderLink["key"], string> = {
  DRIVE: "bg-[linear-gradient(150deg,#34d399,#059669)]",
  SHARED: "bg-[linear-gradient(150deg,#60a5fa,#2563eb)]",
};
const ICON: Record<FolderLink["key"], LucideIcon> = { DRIVE: Folder, SHARED: HardDrive };

/** Arrow keys / Home / End walk the menu items (wrapping); Tab leaves. */
function nextItem(root: HTMLElement, key: string): HTMLElement | null {
  const items = [...root.querySelectorAll<HTMLElement>("[role=menuitem]")];
  if (!items.length) return null;
  const i = items.findIndex((el) => el === document.activeElement);
  const to = ({ ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 } as Record<string, number>)[key];
  return to === undefined ? null : items[(to + items.length) % items.length];
}

/**
 * The Folders tab of the bottom nav (ADR 0016 addendum nav v4, prototype `foldersBtn` / `.navpop`): a button (not a
 * link) that opens a small popover above itself with the two Drive pages — Drive folders (green folder, "Invoices ·
 * bills · GST pack") and Shared links (blue drive, "Folders shared with clients"). Tap the tab again, tap outside,
 * Escape (focus back on the tab) or choosing closes it; so does a resize or a route change. The popover is portalled
 * to <body> and fixed just above the nav (so a sheet's dim, z-50, cannot hide it), centred on the tab and clamped
 * inside the nav row ± 8px — the tab sits near the right edge. `aria-haspopup="menu"`, `aria-expanded`,
 * `aria-controls`, `role="menu"` / `menuitem`, the first item focused on open, ↑ ↓ Home End between them. The tab is
 * highlighted (`aria-current`) on either page (`on`); its icon tint also shows while the popover is up. The + speed
 * dial's own outside-press listener closes the dial when this tab is pressed, and this popover's closes it when the +
 * is pressed, so the two are never open together.
 */
export function FoldersTab({ on }: { on: boolean }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  useEffect(() => setMounted(true), []);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setPos(null);
    if (refocus) btnRef.current?.focus();
  }, []);

  // a route change (choosing, the browser's back…) drops the popover
  useEffect(() => {
    close();
  }, [pathname, close]);

  // centre on the tab, then keep the whole popover inside the nav row (± EDGE)
  useLayoutEffect(() => {
    if (!open) return;
    const b = btnRef.current?.getBoundingClientRect();
    const n = btnRef.current?.closest("nav")?.getBoundingClientRect();
    const p = popRef.current?.getBoundingClientRect();
    if (!b || !n || !p) return;
    let left = b.left + b.width / 2 - p.width / 2;
    left = Math.min(left, n.right - EDGE - p.width);
    left = Math.max(left, n.left + EDGE);
    setPos({ left: Math.round(left), bottom: Math.round(window.innerHeight - n.top + LIFT) });
  }, [open]);

  // the first item takes focus once the popover is placed (it is hidden until measured, and hidden cannot focus)
  useEffect(() => {
    if (open && pos) popRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, [open, pos]);

  useEffect(() => {
    if (!open) return;
    // capture + stop: an underlying sheet (window keydown) must not close as well
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close(true);
    };
    // a press outside the popover and the tab closes it (a press on the tab toggles via its click; one on the + closes
    // here on pointerdown, then the +'s click opens the dial)
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    };
    const onResize = () => close();
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, close]);

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = popRef.current ? nextItem(popRef.current, e.key) : null;
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  const lit = on || open;
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-nav="FOLDERS"
        aria-label="Folders"
        title="Folders"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? MENU_ID : undefined}
        aria-current={on ? "page" : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={navItemCls}
      >
        <span aria-hidden className={clsx(navIconCls, lit && "bg-[var(--nav-on-bg)] text-[var(--nav-on)]")}>
          <Folder size={20} strokeWidth={on ? 2.3 : 2.1} />
        </span>
        <span aria-hidden className={clsx(navLabCls, on ? "text-[var(--nav-on)]" : "text-muted")}>
          {navLabel("Folders")}
        </span>
      </button>
      {open && mounted
        ? createPortal(
            <div
              ref={popRef}
              id={MENU_ID}
              role="menu"
              aria-label="Folders"
              onKeyDown={onMenuKey}
              style={pos ? { left: pos.left, bottom: pos.bottom } : { left: 0, bottom: 0, visibility: "hidden" }}
              className="fixed z-[55] flex min-w-[190px] max-w-[calc(100vw-16px)] flex-col gap-0.5 rounded-2xl border border-hair bg-[var(--bg)] p-1.5 text-ink shadow-[0_14px_34px_-14px_rgba(0,0,0,.6)]"
            >
              {FOLDER_LINKS.map((l) => {
                const Icon = ICON[l.key];
                return (
                  <Link
                    key={l.key}
                    role="menuitem"
                    href={l.href}
                    data-folder={l.key}
                    onClick={() => close()}
                    className="grid grid-cols-[30px_1fr] items-center gap-x-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] font-semibold leading-tight text-ink outline-none hover:bg-chip focus-visible:bg-chip"
                  >
                    <span aria-hidden className={clsx("row-span-2 flex h-[30px] w-[30px] items-center justify-center rounded-[9px] text-white", TONE[l.key])}>
                      <Icon size={16} strokeWidth={2.2} />
                    </span>
                    <span>{l.label}</span>
                    <small className="text-[11px] font-medium text-muted">{l.hint}</small>
                  </Link>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
