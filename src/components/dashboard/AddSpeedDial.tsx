"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { DashboardData } from "@/server/tasks/types";
import { MeetIcon } from "@/components/dashboard/GoogleIcons";
import { KitPickerSheet } from "@/components/dashboard/KitPickerSheet";
import { fabMenu, fabOrder, type FabItem, type FabTone } from "@/components/dashboard/fab-model";

/** Icon squares — same category colours as the Admin menu tiles (money green, team yellow, clients blue). */
const TONE: Record<FabTone, string> = {
  task: "bg-[linear-gradient(150deg,#3b82f6,#1d4ed8)] text-white",
  meet: "border border-hair bg-white",
  money: "bg-[linear-gradient(150deg,#34d399,#059669)] text-white",
  team: "bg-[linear-gradient(150deg,#fcd34d,#f59e0b)] text-[#3b2a00]",
  client: "bg-[linear-gradient(150deg,#60a5fa,#2563eb)] text-white",
};
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
          TONE[it.tone],
        )}
      >
        {Icon ? <Icon size={it.main ? 22 : 20} strokeWidth={2.25} /> : <MeetIcon size={26} />}
      </span>
    </button>
  );
}

/**
 * The bar's single blue "+" (prototype `#addChoose` + `.fabdim`): tapping it rotates the + into × and opens a speed
 * dial stacked upward — Task nearest the thumb, Meeting, then (Admin) the create shortcuts above a thin separator.
 * The dimmed backdrop covers everything above the bar so the × stays tappable. Close on ×, backdrop, Escape (focus
 * back to +) or after choosing. Portalled to <body> and centred like `.phone-frame` (max 480px).
 */
export function AddSpeedDial({ role, onAdd }: { role: DashboardData["role"]; onAdd: (mode: "WORK" | "MEETING") => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kitOpen, setKitOpen] = useState(false);
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
    // A tap on the bar outside the + (date pills, …) also closes the menu, as in the prototype.
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
    const a = it.action;
    if (a.kind === "add") onAdd(a.mode);
    else if (a.kind === "href") router.push(a.href);
    else setKitOpen(true);
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
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,.7)]"
      >
        <Plus size={24} strokeWidth={2.75} aria-hidden className={clsx("fab-plus", open && "rotate-45")} />
      </button>
      {open && mounted
        ? createPortal(
            <div
              ref={dimRef}
              onClick={onBackdrop}
              className="fixed inset-x-0 top-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-40 mx-auto flex w-full max-w-[480px] flex-col items-end justify-end bg-[rgba(2,12,24,.42)] px-2.5 pb-2.5 backdrop-blur-[3px]"
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
      {role === "ADMIN" ? <KitPickerSheet open={kitOpen} onClose={() => setKitOpen(false)} /> : null}
    </>
  );
}
