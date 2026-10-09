"use client";
import { useState } from "react";
import { AlertTriangle, CalendarDays, FolderOpen, Info, MessageSquare, Mic, Pause, Repeat, RotateCcw, Star, User, Video } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { DashboardData, TaskRow as Row } from "@/server/tasks/types";
import { useLongPress } from "@/components/ui/useLongPress";
import { useToast } from "@/components/ui/Toast";
import { ensureTaskDriveFolder } from "@/server/tasks/manage";
import { assigneeChip, firstName } from "@/components/dashboard/format";
import { CompletionCircle, IconBtn, RightPills, stop } from "@/components/dashboard/RowParts";
import { formatInTimeZone } from "date-fns-tz";

export type RowHandlers = {
  onOpen: (t: Row) => void;
  /** Opens the detail sheet scrolled to the attachments (voice notes). */
  onOpenAttachments: (t: Row) => void;
  onLongPress: (t: Row) => void;
  onCircle: (t: Row) => void;
  onRestart: (t: Row) => void;
  onRetry: (t: Row) => void;
};

/** Opens a URL in a new tab. (For URLs resolved asynchronously — see openDrive — the tab is opened first so popup blockers allow it.) */
function openExternal(url: string) {
  window.open(url, "_blank", "noopener");
}

/** 22px rounded chips that wrap instead of truncating the row (glass refresh). */
const CHIP_BASE = "glass-chip inline-flex h-[22px] max-w-[150px] shrink-0 items-center rounded-full px-[9px] text-[11.5px] font-medium leading-none";
const CHIP = `${CHIP_BASE} text-ink`;
const CHIP_ME = `${CHIP_BASE} font-semibold text-me`;

/**
 * Team Leader only: assignee first names (lowercase) printed beside the title, or a person
 * silhouette when the TL assigned the task to themselves.
 */
function AssigneeNames({ t, meId }: { t: Row; meId: string }) {
  const self = t.selfAssigned && t.assignees.some((a) => a.id === meId);
  return (
    <span className="ml-1 shrink-0 text-[12px] font-semibold lowercase text-muted" title={t.assignees.map((a) => a.name).join(", ")}>
      {self ? <User size={14} fill="currentColor" strokeWidth={0} aria-label="Self-assigned" /> : t.assignees.map((a) => firstName(a.name)).join(", ")}
    </span>
  );
}

/**
 * Amber "pref: arjun" chip while an Admin task still sits with its Team Leader(s): every assignee is a Team Leader
 * and Admin suggested executives (ADR 0008).
 */
function PrefChip({ t, data }: { t: Row; data: DashboardData }) {
  if (!t.preferredAssigneeIds.length || !t.assignees.length) return null;
  const role = (id: string) => data.people.find((p) => p.id === id)?.role;
  if (!t.assignees.every((a) => role(a.id) === "TEAM_LEADER")) return null;
  const names = t.preferredAssigneeIds.map((id) => firstName(data.people.find((p) => p.id === id)?.name ?? "?").toLowerCase()).join(", ");
  return (
    <span className={`${CHIP_BASE} truncate text-[#b45309]`} title="Admin preference — Team Leader decides">
      pref: {names}
    </span>
  );
}

export function TaskRow({ t, data, h }: { t: Row; data: DashboardData; h: RowHandlers }) {
  const toast = useToast();
  const [driveBusy, setDriveBusy] = useState(false);
  const press = useLongPress(() => h.onLongPress(t), () => h.onOpen(t));
  const grey = t.colour === "grey";
  const meetDisabled = !t.meetLink || !t.meetActive || t.status === "COMPLETED";
  const hasVoice = t.attachments.some((a) => a.kind === "VOICE_NOTE");

  const openDrive = async () => {
    if (t.driveFolderUrl) return openExternal(t.driveFolderUrl);
    if (driveBusy) return;
    setDriveBusy(true);
    const w = window.open("", "_blank");
    const res = await ensureTaskDriveFolder(t.id);
    setDriveBusy(false);
    if (!res.ok) {
      w?.close();
      toast(res.error, "err");
      return;
    }
    if (w) w.location.href = res.data.url;
    else openExternal(res.data.url);
  };

  const calendarUrl = t.scheduledStart
    ? `https://calendar.google.com/calendar/u/0/r/day/${formatInTimeZone(new Date(t.scheduledStart), data.tz, "yyyy/M/d")}`
    : "https://calendar.google.com/calendar/u/0/r";

  return (
    <li
      {...press}
      className={clsx("no-select task-card", `row-${t.colour}`)}
      data-task-id={t.id}
      aria-label={t.title}
    >
      {t.parentTaskId ? (
        <span className="absolute left-2 top-0 flex h-[18px] w-[18px] items-center justify-center rounded-b-lg bg-restart text-white" aria-label="Restarted task" title="Restarted task">
          <RotateCcw size={10} strokeWidth={3} />
        </span>
      ) : null}

      {/* Line 1: the title runs the full width of the row */}
      <div className="flex items-center gap-1.5">
        <span className={clsx("min-w-0 truncate text-[15px] font-[650] leading-5 tracking-[-.01em] text-ink", grey && "line-through opacity-70")}>{t.title}</span>
        {t.important ? <Star size={12} className="shrink-0 fill-[#F59E0B] text-[#F59E0B]" aria-label="Important" /> : null}
        {t.recurring ? <Repeat size={12} strokeWidth={2.5} className="shrink-0 text-[#2563EB]" aria-label="Recurring" /> : null}
        {t.paused ? (
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-ink" aria-label="Paused" title="Paused">
            <Pause size={9} strokeWidth={3} fill="currentColor" />
          </span>
        ) : null}
        {t.integrationError ? (
          <button
            type="button"
            title={t.integrationError}
            aria-label="Integration error"
            onPointerDown={stop}
            onPointerUp={stop}
            onClick={(e) => {
              e.stopPropagation();
              if (data.role === "ADMIN") h.onRetry(t);
              else toast(t.integrationError!, "err");
            }}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-amber-600"
          >
            <AlertTriangle size={13} />
          </button>
        ) : null}
        {data.role === "TEAM_LEADER" ? <AssigneeNames t={t} meId={data.me.id} /> : null}
      </div>

      {/* Lines 2–3: chips + outline icons on the left; hours / time / date pills and the circle on the right */}
      <div className="mt-1.5 flex items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={CHIP}>{t.client.name}</span>
            <span className={CHIP_ME}>{assigneeChip(t, data.me.id)}</span>
            <PrefChip t={t} data={data} />
            {t.type === "MEETING" ? <span className={`${CHIP_BASE} text-meet`}>Meeting</span> : null}
          </div>
          <div className="-ml-1 mt-1.5 flex items-center gap-1">
            <IconBtn label="Task details" onClick={() => h.onOpen(t)}>
              <Info size={20} strokeWidth={1.75} />
            </IconBtn>
            <IconBtn label="Drive folder" onClick={openDrive} disabled={driveBusy || t.type === "MEETING"}>
              <FolderOpen size={20} strokeWidth={1.75} />
            </IconBtn>
            <IconBtn label="Google Meet" onClick={() => t.meetLink && openExternal(t.meetLink)} disabled={meetDisabled}>
              <Video size={20} strokeWidth={1.75} />
            </IconBtn>
            <IconBtn label="Chat space" onClick={() => t.chatSpaceUrl && openExternal(t.chatSpaceUrl)} disabled={!t.chatSpaceUrl}>
              <MessageSquare size={20} strokeWidth={1.75} />
            </IconBtn>
            <IconBtn label="Calendar" onClick={() => openExternal(calendarUrl)}>
              <CalendarDays size={20} strokeWidth={1.75} />
            </IconBtn>
            {hasVoice ? (
              <IconBtn label="Voice notes" onClick={() => h.onOpenAttachments(t)}>
                <Mic size={20} strokeWidth={1.75} />
              </IconBtn>
            ) : null}
          </div>
        </div>
        <RightPills t={t} tz={data.tz} />
        <CompletionCircle t={t} onTap={() => h.onCircle(t)} onRestart={() => h.onRestart(t)} />
      </div>
    </li>
  );
}
