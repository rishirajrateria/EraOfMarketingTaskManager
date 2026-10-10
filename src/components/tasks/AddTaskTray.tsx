"use client";
import { CalendarDays, ListTodo } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { DashboardData } from "@/server/tasks/types";
import { shortcutStart, type AddTaskForm, type TaskMode } from "@/components/tasks/add-task-helpers";
import { isShortcutDay } from "@/components/tasks/meeting-helpers";
import { detailsCaption } from "@/components/tasks/details-caption";
import { AddTaskGreenRows, TagPill } from "@/components/tasks/AddTaskRows";
import { MeetIcon } from "@/components/dashboard/GoogleIcons";
import { MinimisableTray } from "@/components/dashboard/FilterTray";

export type Shortcut = "upnext" | "tomorrow" | "today";

/** One half of the type switch (prototype `.tyb`): selected = raised glass, ink label; the other muted. */
function TypeButton({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={clsx(
        "no-select inline-flex h-[34px] items-center gap-1.5 rounded-[11px] border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6] disabled:opacity-60",
        on ? "glass-strong text-ink" : "border-transparent text-muted",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Task | Meeting (prototype `.typeseg`, ADR 0016 addendum): a small segmented switch at the top of the form, above the
 * title. It replaces the 44px type toggles of the old add-task row; the + speed dial picks the starting one.
 */
export function TypeSwitch({ type, onType, disabled }: { type: TaskMode | null; onType: (type: TaskMode) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label="Type" className="mb-2.5 inline-flex gap-1 self-start rounded-[14px] border border-hair bg-chip p-[3px]">
      <TypeButton on={type === "WORK"} onClick={() => onType("WORK")} disabled={disabled}>
        <ListTodo size={18} strokeWidth={2.2} aria-hidden className={type === "WORK" ? "text-[var(--nav-on)]" : undefined} />
        Task
      </TypeButton>
      <TypeButton on={type === "MEETING"} onClick={() => onType("MEETING")} disabled={disabled}>
        <MeetIcon size={18} />
        Meeting
      </TypeButton>
    </div>
  );
}

/** 📅 When should it start? · Up next · Today · Tomorrow — the tray's lowest row, nearest the thumb. */
function TimeRow({ form, type, tz, onShortcut, onOpenSchedule }: { form: AddTaskForm; type: TaskMode | null; tz: string; onShortcut: (kind: Shortcut) => void; onOpenSchedule: () => void }) {
  // Meetings: Today / Tomorrow mark the chosen day (the START row sets the time); tasks: the shortcut's exact start.
  const startIs = (kind: "tomorrow" | "today") =>
    type === "MEETING" ? isShortcutDay(kind, form.scheduledStart, new Date(), tz) : !!form.scheduledStart && form.scheduledStart === shortcutStart(kind, new Date(), tz);
  return (
    <div className="scrollbar-none flex h-14 items-center gap-1.5 overflow-x-auto px-3 text-ink" role="group" aria-label="Start">
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
  );
}

/**
 * Bottom of the add-task screen (prototype `#addTray`, ADR 0016 addendum): "the same thing as the dashboard" — the
 * pill rows (Prefer · Work · Team / Exec / Invite · Client · Start) and the time row in a minimisable details tray
 * (MinimisableTray: chevron tab on its top edge; minimised = a 40px bar "⌃ Details · Social · Acme · Up next",
 * remembered per user under its own key). The shell's bottom nav sits right below it, its centre button the ×.
 */
export function AddTaskTray({
  form,
  patch,
  data,
  type,
  tz,
  onShortcut,
  onOpenSchedule,
}: {
  form: AddTaskForm;
  patch: (p: Partial<AddTaskForm>) => void;
  data: DashboardData;
  type: TaskMode | null;
  /** The zone starts are picked in (the meeting's own for meetings). */
  tz: string;
  onShortcut: (kind: Shortcut) => void;
  onOpenSchedule: () => void;
}) {
  return (
    <MinimisableTray kind="details" userId={data.me.id} label={detailsCaption(form, data, new Date(), tz)}>
      <div className="strip-glass pt-1">
        <AddTaskGreenRows form={form} patch={patch} data={data} />
        <TimeRow form={form} type={type} tz={tz} onShortcut={onShortcut} onOpenSchedule={onOpenSchedule} />
      </div>
    </MinimisableTray>
  );
}
