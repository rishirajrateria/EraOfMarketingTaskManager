"use client";
import { CalendarDays, ListTodo } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { DashboardData } from "@/server/tasks/types";
import { shortcutStart, type AddTaskForm, type TaskMode } from "@/components/tasks/add-task-helpers";
import { isShortcutDay } from "@/components/tasks/meeting-helpers";
import { CloseX } from "@/components/ui/CloseX";
import { NavAddButton, NavRow } from "@/components/dashboard/NavRow";
import { fabMenu, type FabItem } from "@/components/dashboard/fab-model";

export type Shortcut = "upnext" | "tomorrow" | "today";

/** Neutral glass pill (32px; ink-filled when active) — same as the tag rows (ADR 0015). */
function TagPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "no-select h-8 shrink-0 whitespace-nowrap rounded-[12px] border px-[11px] text-[12.5px] font-semibold leading-none transition",
        active ? "border-transparent bg-primary text-primary-ink" : "glass-chip border-hair text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Google Meet mark (coloured) — inline so it needs no asset. */
function MeetIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M3 8a2 2 0 0 1 2-2h5v5H3z" fill="#00832D" />
      <path d="M3 11h7v5H5a2 2 0 0 1-2-2z" fill="#0066DA" />
      <path d="M10 6h5v5h-5z" fill="#2684FC" />
      <path d="M10 11h5v5h-5z" fill="#00AC47" />
      <path d="M15 6h.5a1.5 1.5 0 0 1 1.5 1.5V11h-2z" fill="#FFBA00" />
      <path d="M15 11h2v3.5a1.5 1.5 0 0 1-1.5 1.5H15z" fill="#00AC47" />
      <path d="M17 10.2 21 7v8l-4-3.2z" fill="#00AC47" />
    </svg>
  );
}

/** 44px type toggle (prototype `.nb.ty`): the selected one gets a 2px blue ring. */
function TypeToggle({ on, label, onClick, className, children }: { on: boolean; label: string; onClick: () => void; className: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={clsx(
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]",
        on ? "opacity-100 shadow-[0_0_0_2px_var(--bg),0_0_0_4px_#3b82f6]" : "opacity-75",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * Bottom of the add-task screen (prototype `#tBarG` + `#addNav`, ADR 0016 addendum): the time pills on their own row
 * (📅 When should it start? · Up next · Today · Tomorrow), then the 64px nav row — Task / Meeting type toggles, (Admin)
 * the speed dial's other adds as a scrolling icon strip, and the 52px blue × in the dashboard +'s exact spot.
 */
export function AddTaskBottomBar({
  form,
  type,
  tz,
  role,
  onShortcut,
  onType,
  onOpenSchedule,
  onPick,
  onClose,
}: {
  form: AddTaskForm;
  type: TaskMode | null;
  tz: string;
  role: DashboardData["role"];
  onShortcut: (kind: Shortcut) => void;
  onType: (type: TaskMode) => void;
  onOpenSchedule: () => void;
  /** An Admin shortcut in the strip (the sheet closes first). */
  onPick?: (it: FabItem) => void;
  onClose: () => void;
}) {
  // Meetings: Today / Tomorrow mark the chosen day (the START row sets the time); tasks: the shortcut's exact start.
  const startIs = (kind: "tomorrow" | "today") =>
    type === "MEETING" ? isShortcutDay(kind, form.scheduledStart, new Date(), tz) : !!form.scheduledStart && form.scheduledStart === shortcutStart(kind, new Date(), tz);
  const more = onPick ? fabMenu(role).more : [];
  return (
    <div className="shrink-0 pb-[env(safe-area-inset-bottom)]">
      <div className="bar-glass scrollbar-none flex h-14 items-center gap-1.5 overflow-x-auto border-t border-hair px-3 text-ink">
        <button type="button" onClick={onOpenSchedule} aria-label="When should it start?" title="When should it start?" className="flex h-8 w-7 shrink-0 items-center justify-center">
          <CalendarDays size={22} aria-hidden />
        </button>
        <TagPill active={!form.scheduledStart} onClick={() => onShortcut("upnext")}>
          Up next
        </TagPill>
        <TagPill active={startIs("today")} onClick={() => onShortcut("today")}>
          Today
        </TagPill>
        <TagPill active={startIs("tomorrow")} onClick={() => onShortcut("tomorrow")}>
          Tomorrow
        </TagPill>
      </div>
      <NavRow label="Add" right={<CloseX onClick={onClose} />}>
        <div className="flex shrink-0 gap-1.5 pl-1">
          <TypeToggle on={type === "WORK"} label="Task" onClick={() => onType("WORK")} className="bg-[linear-gradient(150deg,#3b82f6,#1d4ed8)] text-white">
            <ListTodo size={22} strokeWidth={2.25} aria-hidden />
          </TypeToggle>
          <TypeToggle on={type === "MEETING"} label="Meeting" onClick={() => onType("MEETING")} className="border border-[rgba(15,23,42,.14)] bg-white">
            <MeetIcon size={22} />
          </TypeToggle>
        </div>
        <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pr-[18px] [mask-image:linear-gradient(90deg,#000_82%,transparent)]">
          {more.map((it) => (
            <NavAddButton key={it.key} it={it} onPick={(x) => onPick?.(x)} />
          ))}
        </div>
      </NavRow>
    </div>
  );
}
