"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, Plus } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { DashboardData } from "@/server/tasks/types";
import { blueSquare } from "@/components/ui/CloseX";
import { MeetIcon } from "@/components/dashboard/GoogleIcons";
import { FAB_TONE, fabMenu, fabOrder, type FabItem } from "@/components/dashboard/fab-model";
import type { FabTarget } from "@/components/dashboard/useFabRunner";
import { cornerStore, useCornerOpen } from "@/components/shell/corner-store";

const STAGGER_MS = 18;
const MENU_ID = "fab-menu";
const focusRing = "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3b82f6] focus-visible:outline-solid";

/** One row: [eye] (list items: view the list) · label chip · coloured square. The eye and the item are separate menuitems. */
function FabRow({ it, index, onPick }: { it: FabItem; index: number; onPick: (it: FabItem, target: FabTarget) => void }) {
  const Icon = it.icon;
  return (
    <div data-fab-row style={{ animationDelay: `${index * STAGGER_MS}ms` }} className="fab-in flex shrink-0 items-center gap-2">
      {it.view ? (
        <button
          type="button"
          role="menuitem"
          data-fab-view={it.key}
          aria-label={it.view.label}
          title="View existing"
          onClick={() => onPick(it, "view")}
          className={clsx("glass-strong flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl text-ink", focusRing)}
        >
          <Eye size={18} strokeWidth={2.1} aria-hidden />
        </button>
      ) : null}
      <button type="button" role="menuitem" data-fab={it.key} aria-label={`Add ${it.label.toLowerCase()}`} onClick={() => onPick(it, "open")} className="group flex shrink-0 items-center gap-2.5 outline-none">
        <span aria-hidden className={clsx("glass-strong whitespace-nowrap rounded-xl px-3 py-[7px] text-[13px] text-ink", it.main ? "font-bold" : "font-semibold")}>{it.label}</span>
        <span
          aria-hidden
          className={clsx(
            "flex shrink-0 items-center justify-center shadow-[0_6px_16px_-8px_rgba(0,0,0,.5)] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-[#3b82f6] group-focus-visible:outline-solid",
            it.main ? "h-[50px] w-[50px] rounded-2xl" : "h-11 w-11 rounded-[14px]",
            FAB_TONE[it.tone],
          )}
        >
          {Icon ? <Icon size={it.main ? 22 : 20} strokeWidth={2.25} /> : <MeetIcon size={26} />}
        </span>
      </button>
    </div>
  );
}

/**
 * Arrow keys in the stack (rows bottom → top in DOM order): ↑ / ↓ = the row above / below, staying on the eye column
 * when both rows have an eye; ← / → = the row's eye / item; Home / End = the first / last row.
 */
function stackTarget(root: HTMLElement, key: string): HTMLElement | null {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const row = active?.closest<HTMLElement>("[data-fab-row]") ?? null;
  if (key === "ArrowLeft" || key === "ArrowRight") return row?.querySelector<HTMLElement>(key === "ArrowLeft" ? "[data-fab-view]" : "[data-fab]") ?? null;
  const rows = [...root.querySelectorAll<HTMLElement>("[data-fab-row]")];
  const i = row ? rows.indexOf(row) : -1;
  const to = ({ ArrowUp: i + 1, ArrowDown: i - 1, Home: 0, End: rows.length - 1 } as Record<string, number>)[key];
  if (to === undefined || !rows.length) return null;
  const next = rows[(to + rows.length) % rows.length];
  const eye = active?.hasAttribute("data-fab-view") ? next.querySelector<HTMLElement>("[data-fab-view]") : null;
  return eye ?? next.querySelector<HTMLElement>("[data-fab]");
}

/**
 * The bottom nav's corner button (prototype `#addChoose` + `.fabdim` + `.fabeye` + `cornerTap`): the one close control.
 * While a sheet or a closable form page is open (corner-store) it is a × (the + rotated 45°, "Close") that closes the
 * most recent one. Otherwise it is the 52px blue "+": tapping it turns it into × and opens a speed dial stacked
 * upward — Task nearest the thumb, Meeting, then (Admin) the create shortcuts above a thin separator; the list items
 * (Executive, Work type, Team, Team leader, Client kit) get a 38px glass eye left of the label. The dimmed backdrop
 * covers everything above the 64px nav row so the × stays tappable. The dial closes on ×, backdrop, a tap elsewhere
 * on the nav row, Escape (focus back to +) or after choosing. Portalled to <body>, centred like `.phone-frame`.
 * `role: null` (HR, CA: no task adding) → only the × shows, while something is open.
 */
export function AddSpeedDial({ role, onPick }: { role: DashboardData["role"] | null; onPick: (it: FabItem, target: FabTarget) => void }) {
  const [open, setOpen] = useState(false);
  const somethingOpen = useCornerOpen();
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menu = useMemo(() => fabMenu(role ?? "EXECUTIVE"), [role]);
  const items = useMemo(() => fabOrder(menu), [menu]);

  useEffect(() => setMounted(true), []);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[data-fab]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(true);
    };
    // A tap on the nav row outside the + (a tab, the page's own bottom zone…) also closes the menu, as in the prototype.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!dimRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, close]);

  const pick = (it: FabItem, target: FabTarget) => {
    close();
    onPick(it, target);
  };

  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = menuRef.current ? stackTarget(menuRef.current, e.key) : null;
    if (!next) return;
    e.preventDefault();
    next.focus();
  };

  const onBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close();
  };

  // × closes: the dial, else the most recent sheet / form page; + opens the dial.
  const isX = open || somethingOpen;
  const onCorner = () => {
    if (open) close();
    else if (!cornerStore.closeTop() && role) setOpen(true);
  };
  if (!role && !isX) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        data-corner={isX ? "close" : "add"}
        aria-label={isX ? "Close" : "Add"}
        title={isX ? "Close" : "Add"}
        aria-haspopup={somethingOpen ? undefined : "menu"}
        aria-expanded={somethingOpen ? undefined : open}
        aria-controls={open ? MENU_ID : undefined}
        onClick={onCorner}
        className={blueSquare}
      >
        <Plus size={26} strokeWidth={2.75} aria-hidden className={clsx("fab-plus", isX && "rotate-45")} />
      </button>
      {open && mounted
        ? createPortal(
            <div
              ref={dimRef}
              onClick={onBackdrop}
              className="fixed inset-x-0 top-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 mx-auto flex w-full max-w-[480px] flex-col items-end justify-end bg-[rgba(2,12,24,.42)] px-2.5 pb-2.5 backdrop-blur-[3px]"
            >
              <div
                ref={menuRef}
                id={MENU_ID}
                role="menu"
                aria-label="Add"
                onKeyDown={onMenuKey}
                onClick={onBackdrop}
                className="scrollbar-none flex max-h-full flex-col-reverse items-end gap-2 overflow-y-auto overflow-x-hidden pt-3"
              >
                {items.map((it, i) => (
                  <Fragment key={it.key}>
                    {i === menu.main.length ? <div role="separator" className="my-0.5 h-px w-11 shrink-0 bg-white/35" /> : null}
                    <FabRow it={it} index={i} onPick={pick} />
                  </Fragment>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
