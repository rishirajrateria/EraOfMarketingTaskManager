"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { DashboardData } from "@/server/tasks/types";
import { blueSquare } from "@/components/ui/CloseX";
import { MeetIcon } from "@/components/dashboard/GoogleIcons";
import { FAB_TONE, fabMenu, fabOrder, type FabItem } from "@/components/dashboard/fab-model";

const STAGGER_MS = 18;
const MENU_ID = "fab-menu";

function FabRow({ it, index, onPick }: { it: FabItem; index: number; onPick: (it: FabItem) => void }) {
  const Icon = it.icon;
  return (
    <button
      type="button"
      role="menuitem"
      data-fab={it.key}
      onClick={() => onPick(it)}
      style={{ animationDelay: `${index * STAGGER_MS}ms` }}
      className="fab-in group flex shrink-0 items-center gap-2.5 outline-none"
    >
      <span className={clsx("glass-strong whitespace-nowrap rounded-xl px-3 py-[7px] text-[13px] text-ink", it.main ? "font-bold" : "font-semibold")}>{it.label}</span>
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
  );
}

/**
 * The dashboard's 52px blue "+" (prototype `#addChoose` + `.fabdim`): tapping it rotates the + into × and opens a
 * speed dial stacked upward — Task nearest the thumb, Meeting, then (Admin) the create shortcuts above a thin
 * separator. The dimmed backdrop covers everything above the 64px nav row so the × stays tappable. Close on ×,
 * backdrop, Escape (focus back to +) or after choosing. Portalled to <body> and centred like `.phone-frame`.
 */
export function AddSpeedDial({ role, onPick }: { role: DashboardData["role"]; onPick: (it: FabItem) => void }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const dimRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menu = useMemo(() => fabMenu(role), [role]);
  const items = useMemo(() => fabOrder(menu), [menu]);

  useEffect(() => setMounted(true), []);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(true);
    };
    // A tap on the bottom rows outside the + (date pills, nav icons…) also closes the menu, as in the prototype.
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

  const pick = (it: FabItem) => {
    close();
    onPick(it);
  };

  /** Arrow keys walk the stack: Up = the item visually above (next in DOM order). */
  const onMenuKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const nodes = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (!nodes.length) return;
    const i = nodes.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowUp: i + 1, ArrowDown: i - 1, Home: 0, End: nodes.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    nodes[(to + nodes.length) % nodes.length]?.focus();
  };

  const onBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) close();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label="Add"
        title={open ? "Close" : "Add"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? MENU_ID : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={blueSquare}
      >
        <Plus size={26} strokeWidth={2.75} aria-hidden className={clsx("fab-plus", open && "rotate-45")} />
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
