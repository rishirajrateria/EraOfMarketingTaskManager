"use client";
import { CalendarDays, X } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { shortcutStart, type AddTaskForm, type TaskMode } from "@/components/tasks/add-task-helpers";
import { isShortcutDay } from "@/components/tasks/meeting-helpers";

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

/** BOTTOM BAR (56px, neutral glass): calendar (opens "When should it start?") + upnext / Tom / today · Meet / Work / X. */
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
    <div className="bar-glass flex h-14 shrink-0 items-stretch pb-[env(safe-area-inset-bottom)]">
      <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pl-3 pr-1 text-ink">
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
      <div className="flex shrink-0 items-center gap-1 pr-2">
        <button type="button" onClick={() => onType("MEETING")} aria-pressed={type === "MEETING"} aria-label="Meeting" className={clsx("flex h-10 w-9 items-center justify-center rounded-xl", type === "MEETING" && "bg-chip")}>
          <MeetIcon size={24} />
        </button>
        <button
          type="button"
          onClick={() => onType("WORK")}
          aria-pressed={type === "WORK"}
          className={clsx(
            "no-select h-8 rounded-[12px] border px-[11px] text-[12.5px] font-semibold leading-none",
            type === "WORK" ? "border-transparent bg-primary text-primary-ink" : "glass-chip border-hair text-ink",
          )}
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
