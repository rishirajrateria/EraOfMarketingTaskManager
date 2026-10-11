"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { clsx } from "@/lib/clsx";
import type { ActualTimeLine } from "@/components/dashboard/actual-time";

const GAP = 6;
const EDGE = 8;

/**
 * The time pill's bubble (prototype `timePop`): scheduled / started / finished, anchored under the pill and
 * right-aligned to it (flips above when there is no room below). It is portalled to <body> with `position: fixed`, so
 * it sits above the neighbouring glass cards (their backdrop-filter makes each card its own stacking context) and is
 * never clipped by the card's `overflow: hidden`. Closes on an outside tap, Escape, scroll or resize. React events
 * bubble through portals, so the bubble stops them before they reach the card's tap / long-press handlers.
 */
export function TimePopover({ id, anchor, lines, onClose }: { id: string; anchor: React.RefObject<HTMLElement | null>; lines: ActualTimeLine[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const b = box.current?.getBoundingClientRect();
    if (!a || !b) return;
    const vw = document.documentElement.clientWidth;
    const below = a.bottom + GAP;
    const top = below + b.height > window.innerHeight - EDGE && a.top - GAP - b.height >= EDGE ? a.top - GAP - b.height : below;
    setPos({ top, right: Math.max(EDGE, vw - a.right) });
  }, [anchor]);

  useEffect(() => {
    const outside = (e: Event) => {
      const target = e.target as Node | null;
      if (target && (box.current?.contains(target) || anchor.current?.contains(target))) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
      anchor.current?.focus();
    };
    const away = () => onClose();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", away);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", away);
    };
  }, [anchor, onClose]);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return createPortal(
    <div
      ref={box}
      id={id}
      role="dialog"
      aria-label="Actual time"
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
      onContextMenu={stop}
      onKeyDown={stop}
      style={pos ? { top: pos.top, right: pos.right } : { top: 0, right: 0, visibility: "hidden" }}
      className="fixed z-[45] flex min-w-[210px] max-w-[calc(100vw-16px)] flex-col gap-1.5 rounded-[14px] border border-line bg-[var(--bg)] px-3 py-2.5 text-[12.5px] text-ink shadow-[0_12px_30px_-10px_rgba(0,0,0,.45)]"
    >
      {lines.map((l) => (
        <div key={l.label} className="grid grid-cols-[78px_1fr] items-baseline gap-x-2" data-line={l.label}>
          <span className="text-muted">{l.label}</span>
          <b className="font-semibold tabular-nums">{l.value}</b>
          {l.note ? <small className={clsx("col-start-2 text-[11.5px]", l.tone === "late" ? "text-late" : l.tone === "ok" ? "text-ontime" : "text-muted")}>{l.note}</small> : null}
        </div>
      ))}
    </div>,
    document.body,
  );
}
