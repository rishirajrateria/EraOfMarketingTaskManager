"use client";
import { useState } from "react";
import { AlertTriangle, CalendarDays, Check, FolderOpen, Info, MessageSquare, Pause, Repeat, RotateCcw, Star, Video } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { dateChip, fmtDate, fmtMinutes, fmtTime } from "@/lib/time";
import type { DashboardData, TaskRow as Row } from "@/server/tasks/types";
import { useLongPress } from "@/components/ui/useLongPress";
import { useToast } from "@/components/ui/Toast";
import { ensureTaskDriveFolder } from "@/server/tasks/manage";
import { assigneeChip, firstName } from "@/components/dashboard/format";

export type RowHandlers = {
  onOpen: (t: Row) => void;
  onLongPress: (t: Row) => void;
  onCircle: (t: Row) => void;
  onRestart: (t: Row) => void;
  onRetry: (t: Row) => void;
};

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Opens a URL in a new tab. (For URLs resolved asynchronously — see openDrive — the tab is opened first so popup blockers allow it.) */
function openExternal(url: string) {
  window.open(url, "_blank", "noopener");
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
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
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-600 active:bg-black/10 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Completion circle (SPEC §5.2): state ring + badges; purple Restart button for completed rows. */
function CompletionCircle({ t, onTap, onRestart }: { t: Row; onTap: () => void; onRestart: () => void }) {
  if (t.status === "COMPLETED") {
    return (
      <button type="button" aria-label="Restart task" title="Restart" onPointerDown={stop} onPointerUp={stop} onClick={(e) => { e.stopPropagation(); onRestart(); }} className="touch-target flex shrink-0 items-center justify-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-restart text-white shadow">
          <RotateCcw size={15} strokeWidth={2.5} />
        </span>
      </button>
    );
  }
  const ring = t.doubtRaised
    ? "border-yellow-500 bg-yellow-400"
    : t.colour === "green"
      ? "border-[3px] border-brand-green bg-white"
      : t.colour === "red"
        ? "border-2 border-red-500 bg-white"
        : "border-2 border-gray-400 bg-white";
  return (
    <button type="button" aria-label="Finish task" title="Tap to request finish" onPointerDown={stop} onPointerUp={stop} onClick={(e) => { e.stopPropagation(); onTap(); }} className="touch-target relative flex shrink-0 items-center justify-center">
      <span className={clsx("flex h-7 w-7 items-center justify-center rounded-full", ring)}>
        {t.paused ? <Pause size={12} strokeWidth={3} className="text-gray-700" /> : t.status === "FINISH_REQUESTED" ? <Check size={14} strokeWidth={3} className="text-brand-green" /> : null}
      </span>
      {t.reviewRequested ? <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" aria-label="Review requested" /> : null}
      {t.important ? <Star size={12} className="absolute left-0.5 top-0.5 fill-amber-400 text-amber-500" aria-label="Important" /> : null}
      {t.recurring ? <Repeat size={11} strokeWidth={2.5} className="absolute bottom-0.5 left-0.5 text-gray-700" aria-label="Recurring" /> : null}
    </button>
  );
}

export function TaskRow({ t, data, h }: { t: Row; data: DashboardData; h: RowHandlers }) {
  const toast = useToast();
  const [driveBusy, setDriveBusy] = useState(false);
  const press = useLongPress(() => h.onLongPress(t), () => h.onOpen(t));
  const tz = data.tz;
  const grey = t.colour === "grey";
  const start = t.scheduledStart ? new Date(t.scheduledStart) : null;
  const end = t.scheduledEnd ? new Date(t.scheduledEnd) : null;
  const meetDisabled = !t.meetLink || !t.meetActive || t.status === "COMPLETED";

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
  const openCalendar = () => {
    const day = fmtDate(start ?? new Date(), tz, "yyyy/M/d");
    openExternal(`https://calendar.google.com/calendar/u/0/r/day/${day}`);
  };

  return (
    <li
      {...press}
      className={clsx("no-select flex items-stretch gap-2 border-b border-black/5 px-3 py-2", `row-${t.colour}`, t.overdue && !grey && "border-l-4 border-l-red-500")}
      data-task-id={t.id}
      aria-label={t.title}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <p className={clsx("min-w-0 flex-1 truncate text-sm font-bold", grey && "line-through")}>{t.title}</p>
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
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-amber-600"
            >
              <AlertTriangle size={14} />
            </button>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px]">
          <span className="rounded bg-black/5 px-1.5 py-0.5 font-medium text-gray-700">{t.client.name}</span>
          <span className="rounded bg-brand-blue/10 px-1.5 py-0.5 font-semibold text-brand-blue-dark">{assigneeChip(t, data.me.id)}</span>
          {t.type === "MEETING" ? <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">Meeting</span> : null}
          {data.role === "TEAM_LEADER" && t.assignees.length ? (
            <span className="truncate text-gray-600">{t.assignees.map((a) => firstName(a.name)).join(", ")}</span>
          ) : null}
        </div>
        <div className="-ml-2 mt-0.5 flex items-center">
          <IconBtn label="Task details" onClick={() => h.onOpen(t)}>
            <Info size={17} />
          </IconBtn>
          <IconBtn label="Drive folder" onClick={openDrive} disabled={driveBusy || t.type === "MEETING"}>
            <FolderOpen size={17} />
          </IconBtn>
          <IconBtn label="Google Meet" onClick={() => t.meetLink && openExternal(t.meetLink)} disabled={meetDisabled}>
            <Video size={17} />
          </IconBtn>
          <IconBtn label="Chat space" onClick={() => t.chatSpaceUrl && openExternal(t.chatSpaceUrl)} disabled={!t.chatSpaceUrl}>
            <MessageSquare size={17} />
          </IconBtn>
          <IconBtn label="Open in Calendar" onClick={openCalendar}>
            <CalendarDays size={17} />
          </IconBtn>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end justify-center text-right text-[11px] leading-tight text-gray-700">
        <span className="text-xs font-semibold text-gray-900">{t.type === "WORK" ? fmtMinutes(t.allocatedMinutes) : "Meet"}</span>
        <span className="whitespace-nowrap">{start ? `${fmtTime(start, tz)} – ${fmtTime(end, tz)}` : "Unscheduled"}</span>
        {t.actualStart ? (
          <span className="whitespace-nowrap text-gray-500">
            {fmtTime(new Date(t.actualStart), tz)} – {t.actualEnd ? fmtTime(new Date(t.actualEnd), tz) : "…"}
          </span>
        ) : null}
        <span className="mt-0.5 rounded bg-black/5 px-1.5 text-[10px] font-medium">{dateChip(start, new Date(), tz)}</span>
      </div>
      <div className="flex shrink-0 items-center">
        <CompletionCircle t={t} onTap={() => h.onCircle(t)} onRestart={() => h.onRestart(t)} />
      </div>
    </li>
  );
}
