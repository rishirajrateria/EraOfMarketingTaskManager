"use client";
import { CalendarDays, X } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { shortcutStart, type AddTaskForm, type TaskMode } from "@/components/tasks/add-task-helpers";
import { isShortcutDay } from "@/components/tasks/meeting-helpers";

export type Shortcut = "upnext" | "tomorrow" | "today";

/** Frosted green pill (28px; near-white when active). */
function TagPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx("no-select h-7 shrink-0 rounded-full px-[13px] text-xs font-medium leading-none transition", active ? "bg-green-pill-on" : "bg-green-pill")}
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

/** BOTTOM BAR (56px): calendar (opens "When should it start?") + upnext/Tom/today (green 62%) · Meet / Work / X (glass 38%). */
export function AddTaskBottomBar({
  form,
  type,
  tz,
  onShortcut,
  onType,
  onOpenSchedule,
  onClose,
}: {
  form: AddTaskForm;
  type: TaskMode | null;
  tz: string;
  onShortcut: (kind: Shortcut) => void;
  onType: (type: TaskMode) => void;
  onOpenSchedule: () => void;
  onClose: () => void;
}) {
  // Meetings: Tom / today mark the chosen day (the START row sets the time); tasks: the shortcut's exact start.
  const startIs = (kind: "tomorrow" | "today") =>
    type === "MEETING" ? isShortcutDay(kind, form.scheduledStart, new Date(), tz) : !!form.scheduledStart && form.scheduledStart === shortcutStart(kind, new Date(), tz);
  return (
    <div className="flex h-14 shrink-0 items-stretch pb-[env(safe-area-inset-bottom)]">
      <div className="bg-green-bar scrollbar-none flex w-[62%] items-center gap-2 overflow-x-auto px-3 text-white">
        <button type="button" onClick={onOpenSchedule} aria-label="When should it start?" title="When should it start?" className="flex h-8 w-7 shrink-0 items-center justify-center">
          <CalendarDays size={22} aria-hidden />
        </button>
        <TagPill active={!form.scheduledStart} onClick={() => onShortcut("upnext")}>
          upnext
        </TagPill>
        <TagPill active={startIs("tomorrow")} onClick={() => onShortcut("tomorrow")}>
          Tom
        </TagPill>
        <TagPill active={startIs("today")} onClick={() => onShortcut("today")}>
          today
        </TagPill>
      </div>
      <div className="bar-glass flex w-[38%] items-center justify-between gap-1 px-2">
        <button type="button" onClick={() => onType("MEETING")} aria-pressed={type === "MEETING"} aria-label="Meeting" className={clsx("flex h-10 w-9 items-center justify-center rounded-xl", type === "MEETING" && "bg-chip")}>
          <MeetIcon size={24} />
        </button>
        <button
          type="button"
          onClick={() => onType("WORK")}
          aria-pressed={type === "WORK"}
          className={clsx("no-select glass-chip h-[30px] rounded-full px-3 text-xs font-semibold leading-none text-ink", type === "WORK" && "ring-1 ring-ink/50")}
        >
          Work
        </button>
        <button type="button" onClick={onClose} aria-label="Close and go back to all tasks" className="flex h-10 w-8 items-center justify-center">
          <X size={24} strokeWidth={2.25} aria-hidden />
        </button>
      </div>
    </div>
  );
}
