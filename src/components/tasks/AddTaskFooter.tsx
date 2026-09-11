"use client";
import { CalendarDays, ClipboardList, X } from "lucide-react";
import { ActionList, Sheet } from "@/components/ui/Sheet";
import { clsx } from "@/lib/clsx";
import type { DashboardData } from "@/server/tasks/types";
import { shortcutStart, toggleId, toggleTeamWithLeader, type AddTaskForm, type Person, type TaskMode } from "@/components/tasks/add-task-helpers";

export type Shortcut = "upnext" | "tomorrow" | "today";

/** Green tag pill (#A9E0AE; white when active). */
function TagPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx("no-select h-[22px] shrink-0 rounded-full px-2.5 text-[11px] font-medium leading-none text-[#111] transition", active ? "bg-white" : "bg-[#A9E0AE]")}
    >
      {children}
    </button>
  );
}

function TagRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="scrollbar-none flex h-[34px] items-center gap-1.5 overflow-x-auto px-3" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** GREEN AREA (TAG MODE): role-specific rows of pills. "All" is white when nothing in the row is selected. */
export function AddTaskTags({
  form,
  patch,
  data,
  executives,
  onTeamsTouched,
}: {
  form: AddTaskForm;
  patch: (p: Partial<AddTaskForm>) => void;
  data: DashboardData;
  executives: Person[];
  onTeamsTouched: () => void;
}) {
  const clientsRow = (
    <TagRow label="Clients">
      <TagPill active={!form.clientId} onClick={() => patch({ clientId: "" })}>
        All
      </TagPill>
      {data.clients.map((c) => (
        <TagPill key={c.id} active={form.clientId === c.id} onClick={() => patch({ clientId: form.clientId === c.id ? "" : c.id })}>
          {c.name}
        </TagPill>
      ))}
    </TagRow>
  );

  return (
    <div className="shrink-0 bg-[#5FC46A]">
      {data.role === "ADMIN" ? (
        <TagRow label="Teams">
          <TagPill
            active={!form.teamIds.length}
            onClick={() => {
              onTeamsTouched();
              patch({ teamIds: [] });
            }}
          >
            All
          </TagPill>
          {data.teams.map((t) => (
            <TagPill
              key={t.id}
              active={form.teamIds.includes(t.id)}
              onClick={() => {
                onTeamsTouched();
                patch(toggleTeamWithLeader(form, data, t.id));
              }}
            >
              {t.name}
            </TagPill>
          ))}
        </TagRow>
      ) : null}
      {data.role === "TEAM_LEADER" ? (
        <TagRow label="Executives">
          <TagPill active={!executives.some((e) => form.assigneeIds.includes(e.id))} onClick={() => patch({ assigneeIds: form.assigneeIds.filter((id) => !executives.some((e) => e.id === id)) })}>
            All
          </TagPill>
          {executives.map((e) => (
            <TagPill key={e.id} active={form.assigneeIds.includes(e.id)} onClick={() => patch({ assigneeIds: toggleId(form.assigneeIds, e.id) })}>
              {e.name.split(" ")[0]}
            </TagPill>
          ))}
        </TagRow>
      ) : null}
      {clientsRow}
    </div>
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

/** Small chooser opened by the type icon: add a task/work, or schedule a meeting. */
export function TaskTypeSheet({ open, onClose, type, onType }: { open: boolean; onClose: () => void; type: TaskMode | null; onType: (t: TaskMode) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="What do you want to add?">
      <ActionList
        items={[
          { label: "Add a task / work", hint: type === "WORK" ? "selected" : "Drive folder, Meet, Chat space", onClick: () => { onType("WORK"); onClose(); } },
          { label: "Schedule a meeting", hint: type === "MEETING" ? "selected" : "Calendar event with Meet link", onClick: () => { onType("MEETING"); onClose(); } },
        ]}
      />
    </Sheet>
  );
}

/** BOTTOM BAR: calendar + upnext/Tom/today (green 62%) · Meet / Work / type selector / X (white 38%). */
export function AddTaskBottomBar({
  form,
  type,
  tz,
  onShortcut,
  onType,
  onOpenSchedule,
  onOpenTypeChooser,
  onClose,
}: {
  form: AddTaskForm;
  type: TaskMode | null;
  tz: string;
  onShortcut: (kind: Shortcut) => void;
  onType: (type: TaskMode) => void;
  onOpenSchedule: () => void;
  onOpenTypeChooser: () => void;
  onClose: () => void;
}) {
  const startIs = (kind: "tomorrow" | "today") => !!form.scheduledStart && form.scheduledStart === shortcutStart(kind, new Date(), tz);
  return (
    <div className="flex h-11 shrink-0 items-stretch">
      <div className="flex w-[62%] items-center gap-1.5 bg-[#2DB84A] px-2 text-white">
        <button type="button" onClick={onOpenSchedule} aria-label="Schedule" className="flex h-8 w-7 shrink-0 items-center justify-center">
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
      <div className="flex w-[38%] items-center justify-between gap-1 bg-white px-2 text-[#111]">
        <button type="button" onClick={() => onType("MEETING")} aria-pressed={type === "MEETING"} aria-label="Meeting" className={clsx("flex h-8 w-7 items-center justify-center rounded", type === "MEETING" && "bg-[#E5E7EB]")}>
          <MeetIcon size={26} />
        </button>
        <button
          type="button"
          onClick={() => onType("WORK")}
          aria-pressed={type === "WORK"}
          className={clsx("no-select h-[22px] rounded-full bg-[#E5E7EB] px-2.5 text-[11px] font-medium leading-none", type === "WORK" ? "text-[#111] ring-1 ring-[#111]/60" : "text-[#4B5563]")}
        >
          Work
        </button>
        <button type="button" onClick={onOpenTypeChooser} aria-label="Choose task or meeting" title={type === "MEETING" ? "Meeting" : "Task / work"} className="relative flex h-8 w-7 items-center justify-center">
          <ClipboardList size={22} strokeWidth={1.75} aria-hidden />
          <span className={clsx("absolute -bottom-0.5 right-0 h-2 w-2 rounded-full", type === "MEETING" ? "bg-[#00AC47]" : "bg-[#2563EB]")} aria-hidden />
        </button>
        <button type="button" onClick={onClose} aria-label="Close and go back to all tasks" className="flex h-8 w-7 items-center justify-center">
          <X size={26} strokeWidth={2.25} aria-hidden />
        </button>
      </div>
    </div>
  );
}
