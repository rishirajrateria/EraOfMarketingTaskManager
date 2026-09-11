"use client";
import { useRef, useState } from "react";
import { AlertTriangle, CalendarDays, FolderOpen, MessageSquare, Mic, Paperclip, Trash2, Upload, Video } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { dateChip, fmtDate, fmtDateTime, fmtMinutes, fmtTime } from "@/lib/time";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { btnPrimary, btnSecondary } from "@/components/ui/Field";
import { deleteAttachment, retryIntegrations, uploadAttachment } from "@/server/tasks/manage";
import { useTaskAction } from "@/components/dashboard/useTaskAction";
import { fmtSeconds, sanitizeHtml, statusLabel, waveformHeights } from "@/components/dashboard/format";

function LinkBtn({ href, label, icon, disabled }: { href: string | null; label: string; icon: React.ReactNode; disabled?: boolean }) {
  const off = disabled || !href;
  return (
    <a
      href={off ? undefined : href!}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={off}
      className={clsx("flex flex-col items-center gap-1 rounded-lg border px-2 py-2 text-[11px]", off ? "pointer-events-none border-gray-200 text-gray-300" : "border-gray-300 text-gray-700 active:bg-gray-100")}
    >
      {icon}
      {label}
    </a>
  );
}

function Waveform({ id, playing }: { id: string; playing: boolean }) {
  return (
    <span className={clsx("waveform inline-flex h-6 items-center", playing ? "text-brand-blue" : "text-gray-500")} aria-hidden>
      {waveformHeights(id).map((h, i) => (
        <span key={i} style={{ height: h }} />
      ))}
    </span>
  );
}

function VoiceNote({ a }: { a: TaskRow["attachments"][number] }) {
  const [playing, setPlaying] = useState(false);
  const ref = useRef<HTMLAudioElement>(null);
  return (
    <div className="flex items-center gap-2">
      <button type="button" aria-label={playing ? "Pause voice note" : "Play voice note"} onClick={() => (playing ? ref.current?.pause() : ref.current?.play())} className="touch-target flex items-center justify-center rounded-full bg-brand-blue/10 text-brand-blue">
        <Mic size={18} />
      </button>
      <Waveform id={a.id} playing={playing} />
      <span className="text-[11px] text-gray-500">{fmtSeconds(a.durationSec)}</span>
      <audio ref={ref} src={a.url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="hidden" />
    </div>
  );
}

/** The `i` icon: full task details (SPEC §5.2). */
export function TaskDetailSheet({
  task,
  data,
  open,
  onClose,
  onActions,
  onOpenTask,
}: {
  task: TaskRow | null;
  data: DashboardData;
  open: boolean;
  onClose: () => void;
  onActions: (t: TaskRow) => void;
  onOpenTask: (id: string) => void;
}) {
  const { run, busy } = useTaskAction();
  const fileRef = useRef<HTMLInputElement>(null);
  if (!task) return null;
  const t = task;
  const tz = data.tz;
  const isAdmin = data.role === "ADMIN";
  const start = t.scheduledStart ? new Date(t.scheduledStart) : null;
  const end = t.scheduledEnd ? new Date(t.scheduledEnd) : null;
  const calendarUrl = `https://calendar.google.com/calendar/u/0/r/day/${fmtDate(start ?? new Date(), tz, "yyyy/M/d")}`;
  const voice = t.attachments.filter((a) => a.kind === "VOICE_NOTE");
  const files = t.attachments.filter((a) => a.kind !== "VOICE_NOTE");

  const onUpload = async (f: File | undefined) => {
    if (!f) return;
    const form = new FormData();
    form.set("taskId", t.id);
    form.set("kind", f.type.startsWith("image/") ? "IMAGE" : "FILE");
    form.set("file", f);
    await run(uploadAttachment(form), "Uploaded to Drive folder");
    if (fileRef.current) fileRef.current.value = "";
  };

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-gray-500">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title="Task details">
      <div className="space-y-4 px-4 pb-8 pt-3">
        <div className={clsx("rounded-xl px-3 py-2", `row-${t.colour}`)}>
          <p className={clsx("text-base font-bold", t.colour === "grey" && "line-through")}>{t.title}</p>
          <p className="text-xs text-gray-600">
            {statusLabel(t)} · {t.client.name} · {t.type === "MEETING" ? "Meeting" : fmtMinutes(t.allocatedMinutes)} · {dateChip(start, new Date(), tz)}
            {t.important ? " · ★ important" : ""}
            {t.recurring ? " · ↻ recurring" : ""}
            {t.protected ? " · protected" : ""}
          </p>
        </div>

        {t.integrationError ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1 break-words">{t.integrationError}</span>
            {isAdmin ? (
              <button type="button" disabled={busy} className="shrink-0 font-semibold underline" onClick={() => run(retryIntegrations(t.id), "Retrying integrations")}>
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-4 gap-2">
          <LinkBtn href={t.driveFolderUrl} label="Drive" icon={<FolderOpen size={18} />} disabled={t.type === "MEETING"} />
          <LinkBtn href={t.meetLink} label="Meet" icon={<Video size={18} />} disabled={!t.meetActive || t.status === "COMPLETED"} />
          <LinkBtn href={t.chatSpaceUrl} label="Chat" icon={<MessageSquare size={18} />} />
          <LinkBtn href={calendarUrl} label="Calendar" icon={<CalendarDays size={18} />} />
        </div>

        <section>
          <Row k="Scheduled" v={start ? `${fmtDateTime(start, tz)} – ${fmtTime(end, tz)}` : "Unscheduled"} />
          <Row k="Actual" v={t.actualStart ? `${fmtDateTime(new Date(t.actualStart), tz)} – ${t.actualEnd ? fmtTime(new Date(t.actualEnd), tz) : "running"}` : "Not started"} />
          {t.finishRequestedAt ? <Row k="Finish requested" v={fmtDateTime(new Date(t.finishRequestedAt), tz)} /> : null}
          <Row k="Priority" v={t.priority.toLowerCase()} />
          <Row
            k="Assignees"
            v={
              <span className="flex flex-wrap justify-end gap-1">
                {t.assignees.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 py-0.5 pl-0.5 pr-2 text-xs">
                    <Avatar name={a.name} src={a.avatar} size={18} />
                    {a.name}
                  </span>
                ))}
              </span>
            }
          />
          {t.teams.length ? <Row k="Teams" v={t.teams.map((x) => x.name).join(", ")} /> : null}
          {t.tags.length ? (
            <Row
              k="Tags"
              v={
                <span className="flex flex-wrap justify-end gap-1">
                  {t.tags.map((x) => (
                    <span key={x.id} className="rounded-full px-2 py-0.5 text-[11px] text-white" style={{ background: x.colour || "#6b7280" }}>
                      {x.name}
                    </span>
                  ))}
                </span>
              }
            />
          ) : null}
          {t.parentTaskId ? <Row k="Restarted from" v={<button type="button" className="text-brand-blue underline" onClick={() => onOpenTask(t.parentTaskId!)}>previous task</button>} /> : null}
          {t.childTaskId ? <Row k="Restarted as" v={<button type="button" className="text-brand-blue underline" onClick={() => onOpenTask(t.childTaskId!)}>new task</button>} /> : null}
        </section>

        {t.doubtNote || t.reviewNote ? (
          <section className="space-y-1">
            {t.doubtNote ? (
              <p className="rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-900">
                <span className="font-semibold">Doubt: </span>
                {t.doubtNote}
              </p>
            ) : null}
            {t.reviewNote ? (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900">
                <span className="font-semibold">Request: </span>
                {t.reviewNote}
              </p>
            ) : null}
          </section>
        ) : null}

        {t.description ? (
          <section>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Description</h3>
            <div className="prose prose-sm max-w-none break-words text-sm text-gray-800 [&_a]:text-brand-blue [&_a]:underline" dangerouslySetInnerHTML={{ __html: sanitizeHtml(t.description) }} />
          </section>
        ) : null}

        <section id="task-attachments">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Attachments</h3>
            {t.type === "WORK" ? (
              <>
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
                <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="flex items-center gap-1 text-xs font-medium text-brand-blue">
                  <Upload size={14} /> Upload
                </button>
              </>
            ) : null}
          </div>
          {voice.length === 0 && files.length === 0 ? <p className="text-xs text-gray-400">No attachments</p> : null}
          <div className="space-y-2">
            {voice.map((a) => (
              <div key={a.id} className="flex items-center gap-1">
                <VoiceNote a={a} />
                {isAdmin ? (
                  <button type="button" aria-label="Delete voice note" disabled={busy} onClick={() => run(deleteAttachment(a.id), "Deleted")} className="touch-target ml-auto flex items-center justify-center text-gray-400">
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
            ))}
            {files.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm">
                <Paperclip size={14} className="shrink-0 text-gray-500" />
                <a href={a.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-brand-blue underline">
                  {a.name}
                </a>
                {isAdmin ? (
                  <button type="button" aria-label="Delete attachment" disabled={busy} onClick={() => run(deleteAttachment(a.id), "Deleted")} className="touch-target flex items-center justify-center text-gray-400">
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Close
          </button>
          <button type="button" className={btnPrimary} onClick={() => onActions(t)}>
            Actions
          </button>
        </div>
      </div>
    </Sheet>
  );
}
