"use client";
import { useState } from "react";
import { AlertTriangle, Info, Mic, Pause, Repeat, RotateCcw, Star, User } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { DashboardData, TaskRow as Row } from "@/server/tasks/types";
import { useLongPress } from "@/components/ui/useLongPress";
import { useToast } from "@/components/ui/Toast";
import { ensureTaskDriveFolder } from "@/server/tasks/manage";
import { assigneeChip, firstName } from "@/components/dashboard/format";
import { ChatIcon, DriveIcon, MeetIcon } from "@/components/dashboard/GoogleIcons";
import { CompletionCircle, DateChip, IconBtn, TimePill, stop } from "@/components/dashboard/RowParts";

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

const CHIP = "min-w-[28px] max-w-[52px] shrink truncate rounded-full bg-[#E5E7EB] px-1.5 py-0.5 text-[10px] leading-3 text-[#111]";

/**
 * Team Leader only: assignee first names (lowercase) in a fixed 60px column beside the title (line 1), or a person
 * silhouette when the TL assigned the task to themselves. Line 2 (chips + icons) runs underneath at full width.
 */
function AssigneeNames({ t, meId }: { t: Row; meId: string }) {
  const self = t.selfAssigned && t.assignees.some((a) => a.id === meId);
  return (
    <div className="ml-1 w-[60px] shrink-0 truncate text-[12px] font-bold lowercase leading-4 text-[#111]" title={t.assignees.map((a) => a.name).join(", ")}>
      {self ? <User size={14} fill="#111" strokeWidth={0} aria-label="Self-assigned" /> : t.assignees.map((a) => firstName(a.name)).join(", ")}
    </div>
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

  return (
    <li
      {...press}
      className={clsx("no-select relative flex min-h-[62px] items-center gap-1 border-b border-white py-1.5 pl-[14px] pr-2", `row-${t.colour}`)}
      data-task-id={t.id}
      aria-label={t.title}
    >
      {t.parentTaskId ? (
        <span className="absolute -left-0.5 top-[13px] flex h-4 w-4 items-center justify-center rounded-full bg-restart text-white" aria-label="Restarted task" title="Restarted task">
          <RotateCcw size={10} strokeWidth={3} />
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className={clsx("relative min-w-0", t.important && "mr-1.5")}>
            <span className={clsx("block truncate text-[13px] font-medium leading-4 text-[#111]", grey && "line-through")}>{t.title}</span>
            {t.important ? <Star size={10} className="absolute -right-2 -top-1 fill-[#F59E0B] text-[#F59E0B]" aria-label="Important" /> : null}
          </span>
          {t.recurring ? <Repeat size={10} strokeWidth={3} className="shrink-0 text-[#2563EB]" aria-label="Recurring" /> : null}
          {t.paused ? (
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#111] text-white" aria-label="Paused" title="Paused">
              <Pause size={9} strokeWidth={3} fill="#fff" />
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
        <div className="mt-[3px] flex items-center gap-1.5 overflow-hidden">
          <span className={CHIP}>{t.client.name}</span>
          <span className={CHIP}>{assigneeChip(t, data.me.id)}</span>
          <IconBtn label="Task details" onClick={() => h.onOpen(t)}>
            <Info size={14} strokeWidth={2.25} />
          </IconBtn>
          <IconBtn label="Drive folder" onClick={openDrive} disabled={driveBusy || t.type === "MEETING"}>
            <DriveIcon muted={t.type === "MEETING"} />
          </IconBtn>
          <IconBtn label={hasVoice ? "Voice notes" : "No voice notes"} onClick={() => h.onOpenAttachments(t)}>
            <Mic size={14} strokeWidth={2.25} className={hasVoice ? "text-[#111]" : "text-[#9CA3AF]"} />
          </IconBtn>
          <IconBtn label="Chat space" onClick={() => t.chatSpaceUrl && openExternal(t.chatSpaceUrl)} disabled={!t.chatSpaceUrl}>
            <ChatIcon muted={!t.chatSpaceUrl} />
          </IconBtn>
          <IconBtn label="Google Meet" onClick={() => t.meetLink && openExternal(t.meetLink)} disabled={meetDisabled}>
            <MeetIcon muted={meetDisabled} />
          </IconBtn>
        </div>
      </div>

      <TimePill t={t} tz={data.tz} />
      <DateChip t={t} tz={data.tz} />
      <CompletionCircle t={t} onTap={() => h.onCircle(t)} onRestart={() => h.onRestart(t)} />
    </li>
  );
}
