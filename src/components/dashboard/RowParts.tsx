"use client";
import { useCallback, useId, useRef, useState } from "react";
import { Check, Pause, RotateCcw } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { fmtMinutes, fmtTime } from "@/lib/time";
import { actualTone } from "@/server/tasks/state";
import { REVIEW_FIELD_NAME, type ReviewField } from "@/server/tasks/review-fields";
import type { TaskRow as Row } from "@/server/tasks/types";
import { datePill } from "@/components/dashboard/format";
import { actualTimeLines } from "@/components/dashboard/actual-time";
import { TimePopover } from "@/components/dashboard/TimePopover";

export const stop = (e: React.SyntheticEvent) => e.stopPropagation();

const HOLD_MS = 450;

/**
 * Inline outline icon button on the icon line of a card (details / Drive / Meet / Chat / Call / WhatsApp / Email / voice
 * notes). The buttons share the space left by the time pill (flex 1 1 0, 20–30px wide), so 7–8 icons and the pill fit
 * at 360px.
 */
export function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-8 min-w-5 max-w-[30px] flex-[1_1_0] items-center justify-center rounded-[10px] p-0 text-muted active:bg-chip disabled:opacity-35 [&>svg]:shrink-0"
    >
      {children}
    </button>
  );
}

/**
 * Hold (450 ms, primary button / touch) or right-click / Shift+F10 / the context-menu key → `onMenu`. The click that
 * follows a hold is swallowed (`consumed()`), so a tap and a hold never both fire. Pointer events never reach the card.
 */
function useHoldMenu(onMenu: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const [holding, setHolding] = useState(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      fired.current = false;
      if (e.button !== 0) return; // right button → contextmenu
      setHolding(true);
      timer.current = setTimeout(() => {
        fired.current = true;
        setHolding(false);
        onMenu();
      }, HOLD_MS);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.stopPropagation();
      clear();
      if (fired.current) setTimeout(() => (fired.current = false), 350); // swallow the click that follows a hold
    },
    onPointerLeave: clear,
    onPointerCancel: clear,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        onMenu();
      }
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const inHold = timer.current !== null;
      clear();
      if (fired.current) return; // a touch hold already opened it (Android also raises contextmenu)
      if (inHold) fired.current = true;
      onMenu();
    },
  };
  /** True (once) when the current click is the tail of a hold. */
  const consumed = () => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  };
  return { holding, handlers, consumed };
}

const PILL = "glass-chip relative inline-flex h-6 items-center rounded-full px-[9px] text-[11.5px] leading-none whitespace-nowrap tabular-nums";
/** No text selection or iOS callout on a long-press. */
const NO_CALLOUT = "select-none [-webkit-touch-callout:none] [-webkit-user-select:none]";

type PopupProps = { ref: React.Ref<HTMLButtonElement>; expanded: boolean; controls: string; hint: string };

/**
 * A pill that can be reviewed (ADR 0015): start date, time allotted or start time. Hold / right-click → the review menu
 * (request / withdraw / mark reviewed / flag); a red dot shows the pill is under review. A plain tap calls `onTap` (the
 * details, or the time pill's actual-time bubble — `popup` wires its aria-expanded / aria-controls). `dot` adds the
 * small currentColor dot after the text that hints there is more behind the tap.
 */
export function ReviewPill({ t, field, text, className, onMenu, onTap, popup, dot }: { t: Row; field: ReviewField; text: string; className?: string; onMenu: () => void; onTap: () => void; popup?: PopupProps; dot?: boolean }) {
  const { holding, handlers, consumed } = useHoldMenu(onMenu);
  const flagged = t.reviewFields.includes(field);
  const name = REVIEW_FIELD_NAME[field];
  return (
    <button
      type="button"
      ref={popup?.ref}
      {...handlers}
      onClick={(e) => {
        e.stopPropagation();
        if (!consumed()) onTap();
      }}
      aria-haspopup={popup ? "dialog" : "menu"}
      aria-expanded={popup?.expanded}
      aria-controls={popup?.expanded ? popup.controls : undefined}
      aria-label={`${name[0]!.toUpperCase()}${name.slice(1)}: ${text}${popup?.hint ?? ""}${flagged ? " · review requested" : ""} (${popup ? "tap for the actual time, " : ""}hold or right-click to review)`}
      title={flagged ? `Review requested on the ${name}` : `Hold or right-click to request a review of the ${name}`}
      data-review={flagged || undefined}
      className={clsx(PILL, NO_CALLOUT, holding && "ring-2 ring-primary/40", flagged && "shadow-[inset_0_0_0_1.5px_rgba(239,68,68,.75)]", className)}
    >
      {text}
      {dot ? <span aria-hidden className="ml-[5px] h-[5px] w-[5px] shrink-0 rounded-full bg-current" data-actual-dot /> : null}
      {flagged ? <span aria-hidden className="absolute -right-1 -top-1 h-[10px] w-[10px] rounded-full bg-[#EF4444] shadow-[0_0_0_2px_var(--bg)]" /> : null}
    </button>
  );
}

/** Date pill ("08 Oct") + hours pill ("4hrs"; meetings "🎥 30m"), both reviewable. */
export function DateHoursPills({ t, tz, onPillMenu, onTap }: { t: Row; tz: string; onPillMenu: (field: ReviewField) => void; onTap: () => void }) {
  const start = t.scheduledStart ? new Date(t.scheduledStart) : null;
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ReviewPill t={t} field="date" text={datePill(start, tz)} className="font-medium text-ink" onMenu={() => onPillMenu("date")} onTap={onTap} />
      <ReviewPill t={t} field="mins" text={t.type === "MEETING" ? `🎥 ${fmtMinutes(t.allocatedMinutes)}` : fmtMinutes(t.allocatedMinutes)} className="font-bold text-ink" onMenu={() => onPillMenu("mins")} onTap={onTap} />
    </div>
  );
}

/**
 * Scheduled window "11:00am – 3:00pm", reviewable as the start time (hold / right-click → review menu). A tap opens the
 * actual-time bubble (scheduled / started / finished). Before the start it is red only while late to start; once
 * started (or finished) its text turns green on time / red late (`actualTone`) with a small dot after it.
 */
export function TimePill({ t, tz, onPillMenu }: { t: Row; tz: string; onPillMenu: (field: ReviewField) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const close = useCallback(() => setOpen(false), []);
  const now = new Date();
  const start = t.scheduledStart ? new Date(t.scheduledStart) : null;
  const end = t.scheduledEnd ? new Date(t.scheduledEnd) : null;
  const tone = actualTone(t, now);
  const lateToStart = !tone && t.colour === "red" && !t.actualStart;
  const colour = tone === "red" || lateToStart ? "font-semibold text-late" : tone === "green" ? "font-semibold text-ontime" : "font-medium text-ink";
  const hint = tone ? ` · actual ${tone === "red" ? "late" : "on time"}` : "";
  return (
    <>
      <ReviewPill
        t={t}
        field="time"
        text={`${fmtTime(start, tz)} – ${fmtTime(end, tz)}`}
        className={clsx("shrink-0", colour)}
        dot={!!tone}
        popup={{ ref, expanded: open, controls: popId, hint }}
        onMenu={() => {
          setOpen(false);
          onPillMenu("time");
        }}
        onTap={() => setOpen((o) => !o)}
      />
      {open ? <TimePopover id={popId} anchor={ref} lines={actualTimeLines(t, tz, now)} onClose={close} /> : null}
    </>
  );
}

/**
 * 32px completion circle (ADR 0015, like Google Tasks): a TAP marks the task done from my side (with Undo); a
 * LONG-PRESS (a ring fills while holding) or RIGHT-CLICK / Shift+F10 / the context-menu key opens the task's action
 * menu. Completed rows show the ⟳ Restart button instead.
 */
export function CompletionCircle({ t, pendingDone, onTap, onMenu, onRestart }: { t: Row; pendingDone?: boolean; onTap: () => void; onMenu: () => void; onRestart: () => void }) {
  const { holding, handlers, consumed } = useHoldMenu(onMenu);
  const completed = t.status === "COMPLETED";
  const done = pendingDone || t.status === "FINISH_REQUESTED";
  const ring = completed ? "border-2 border-ink bg-chip" : done ? "border-2 border-[#16A34A] bg-[#16A34A] text-white" : t.colour === "green" ? "border-2 border-[#16A34A] bg-chip" : "border-2 border-ink bg-chip";
  return (
    <button
      type="button"
      {...handlers}
      onClick={(e) => {
        e.stopPropagation();
        if (consumed()) return;
        if (completed) onRestart();
        else onTap();
      }}
      aria-label={completed ? "Restart task" : done ? "Done from my side" : "Mark done"}
      aria-haspopup="menu"
      aria-pressed={completed ? undefined : done}
      title={completed ? "Restart · hold or right-click: actions" : "Tap: done · hold or right-click: actions"}
      data-holding={holding}
      className={clsx("circle-hold flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink shadow-[0_2px_8px_-4px_rgba(0,0,0,.35)]", NO_CALLOUT, ring)}
    >
      {completed ? <RotateCcw size={15} strokeWidth={2.5} /> : t.paused ? <Pause size={13} strokeWidth={3} /> : done ? <Check size={16} strokeWidth={3} aria-hidden /> : null}
    </button>
  );
}
