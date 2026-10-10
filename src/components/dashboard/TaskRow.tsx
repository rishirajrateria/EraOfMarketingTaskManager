"use client";
import { useState } from "react";
import { AlertTriangle, FolderOpen, Info, Mail, MessageSquare, Mic, Pause, Phone, Repeat, RotateCcw, Video } from "lucide-react";
import { clsx } from "@/lib/clsx";
import type { DashboardData, TaskRow as Row } from "@/server/tasks/types";
import { useLongPress } from "@/components/ui/useLongPress";
import { useToast } from "@/components/ui/Toast";
import { ensureTaskDriveFolder } from "@/server/tasks/manage";
import { teamChipLabel } from "@/components/dashboard/format";
import { CompletionCircle, DateHoursPills, IconBtn, TimePill, stop } from "@/components/dashboard/RowParts";
import type { ReviewField } from "@/server/tasks/review-fields";
import { WhatsAppIcon } from "@/components/shell/TopIcons";
import type { ContactMode } from "@/components/dashboard/contacts";

export type RowHandlers = {
  onOpen: (t: Row) => void;
  /** Opens the detail sheet scrolled to the attachments (voice notes). */
  onOpenAttachments: (t: Row) => void;
  onLongPress: (t: Row) => void;
  onCircle: (t: Row) => void;
  onRestart: (t: Row) => void;
  onRetry: (t: Row) => void;
  /** Hold / right-click on the date, hours or start-time pill → the review menu for that pill (ADR 0015). */
  onPillMenu: (t: Row, field: ReviewField) => void;
  /** Phone / WhatsApp / Email icons → the contact sheet (who depends on the viewer's role, ADR 0017). */
  onContact: (t: Row, mode: ContactMode) => void;
};

/** Opens a URL in a new tab. (For URLs resolved asynchronously — see openDrive — the tab is opened first so popup blockers allow it.) */
function openExternal(url: string) {
  window.open(url, "_blank", "noopener");
}

/** 22px rounded chips that wrap instead of truncating the row (glass refresh). */
const CHIP_SHAPE = "inline-block h-[22px] min-w-0 max-w-[150px] shrink truncate rounded-full px-[9px] text-[11.5px] font-medium leading-[22px]";
const CHIP = `glass-chip ${CHIP_SHAPE} text-ink`;
/** The task's team (ADR 0015): a subtle teal chip next to the client, readable in light and dark. */
const TEAM_CHIP = `${CHIP_SHAPE} border border-hair bg-team-bg text-team`;

/**
 * A compact task card (prototype `taskRow`, ADR 0015): title (2 lines) + badges · circle / client + team chips · date
 * + hours pills / icons · the scheduled time (tap it for the actual start / finish). No people on the card — they are in (i).
 * Right-click (desktop), long-press (phone) or Shift+F10 / the context-menu key opens the action menu.
 */
export function TaskRow({ t, data, h, pendingDone }: { t: Row; data: DashboardData; h: RowHandlers; pendingDone?: boolean }) {
  const toast = useToast();
  const [driveBusy, setDriveBusy] = useState(false);
  const press = useLongPress(() => h.onLongPress(t), () => h.onOpen(t));
  const grey = t.colour === "grey";
  // The Meet link lives until the task is deleted (ADR 0015) — completed tasks keep it.
  const meetDisabled = !t.meetLink || !t.meetActive;
  const team = teamChipLabel(t.teams);
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


  const open = () => h.onOpen(t);
  const pillMenu = (field: ReviewField) => h.onPillMenu(t, field);

  return (
    <li
      {...press}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
          e.preventDefault();
          h.onLongPress(t);
        }
      }}
      className={clsx("no-select task-card", `row-${t.colour}`)}
      data-task-id={t.id}
      aria-label={t.title}
    >
      {t.parentTaskId ? (
        <span className="absolute left-2 top-0 flex h-[18px] w-[18px] items-center justify-center rounded-b-lg bg-restart text-white" aria-label="Restarted task" title="Restarted task">
          <RotateCcw size={10} strokeWidth={3} />
        </span>
      ) : null}

      {/* Row 1: title (2 lines max) + badges · the circle top-right */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 pt-1">
          <span className={clsx("line-clamp-2 text-[15px] font-[650] leading-5 tracking-[-.01em] text-ink", grey && "line-through")}>
            {t.title}
            {t.recurring ? <Repeat size={12} strokeWidth={2.5} className="ml-1.5 inline-block align-[-1px] text-[#2563EB]" aria-label="Recurring" /> : null}
            {t.paused ? (
              <span className="ml-1.5 inline-flex h-[16px] w-[16px] items-center justify-center rounded-full bg-primary align-[-2px] text-primary-ink" aria-label="Paused" title="Paused">
                <Pause size={8} strokeWidth={3} fill="currentColor" />
              </span>
            ) : null}
            {t.doubtRaised ? (
              <span
                className="ml-1.5 inline-flex h-[17px] w-[17px] items-center justify-center rounded-full bg-[#8b5cf6] align-[-2px] text-[11px] font-black leading-none text-white"
                aria-label="Doubt raised"
                title={t.doubtNote ? `Doubt: ${t.doubtNote}` : "Doubt raised"}
              >
                ?
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
                className="ml-1.5 inline-flex h-4 w-4 items-center justify-center align-[-2px] text-amber-600"
              >
                <AlertTriangle size={13} />
              </button>
            ) : null}
          </span>
        </div>
        <CompletionCircle t={t} pendingDone={pendingDone} onTap={() => h.onCircle(t)} onMenu={() => h.onLongPress(t)} onRestart={() => h.onRestart(t)} />
      </div>

      {/* Row 2: client + team chips (one line) · date + hours pills */}
      <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <span className={CHIP}>{t.client.name}</span>
          {team ? (
            <span className={TEAM_CHIP} title={t.teams.map((x) => x.name).join(", ")}>
              {team}
            </span>
          ) : null}
        </div>
        <DateHoursPills t={t} tz={data.tz} onPillMenu={pillMenu} onTap={open} />
      </div>

      {/* Row 3: the icons (7–8, each 20–30px, shrinking to fit) · the scheduled window, which shows the actual time on tap */}
      <div className="mt-1 flex min-w-0 items-center justify-between gap-1">
        <div className="-ml-1.5 flex min-w-0 flex-[1_1_auto] items-center">
          <IconBtn label="Task details" onClick={open}>
            <Info size={19} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="Drive folder" onClick={openDrive} disabled={driveBusy}>
            <FolderOpen size={19} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="Google Meet" onClick={() => t.meetLink && openExternal(t.meetLink)} disabled={meetDisabled}>
            <Video size={19} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="Chat space" onClick={() => t.chatSpaceUrl && openExternal(t.chatSpaceUrl)} disabled={!t.chatSpaceUrl}>
            <MessageSquare size={19} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="Call" onClick={() => h.onContact(t, "call")}>
            <Phone size={18} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="WhatsApp" onClick={() => h.onContact(t, "wa")}>
            <WhatsAppIcon size={19} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="Email" onClick={() => h.onContact(t, "mail")}>
            <Mail size={18} strokeWidth={1.75} />
          </IconBtn>
          {hasVoice ? (
            <IconBtn label="Voice notes" onClick={() => h.onOpenAttachments(t)}>
              <Mic size={19} strokeWidth={1.75} />
            </IconBtn>
          ) : null}
        </div>
        <TimePill t={t} tz={data.tz} onPillMenu={pillMenu} />
      </div>
    </li>
  );
}
