"use client";
import { useRef } from "react";
import { Users, X } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { ChipButton, Stepper } from "@/components/ui/Controls";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/tasks/RichTextEditor";
import { DictationButton } from "@/components/tasks/DictationButton";
import { VoiceNoteRecorder, type VoiceNote } from "@/components/tasks/VoiceRecorder";
import { HOUR_PRESETS, fmtHours, stepHours, type AddTaskForm } from "@/components/tasks/add-task-helpers";
import { describeRule } from "@/server/tasks/repeat-rule";
import { DURATION_PRESETS, fmtDuration } from "@/components/tasks/meeting-helpers";

type Props = {
  form: AddTaskForm;
  patch: (p: Partial<AddTaskForm>) => void;
  titleError?: string;
  hoursError?: string;
  /** Meetings: the people glyph next to Save opens the attendee chooser. */
  canPickAssignees: boolean;
  onOpenAssignees: () => void;
  /** Meetings: the ⚙ Options chip (Google Calendar options, ADR 0012). */
  onOpenOptions?: () => void;
  /** Meetings: invited people besides me + external guests (badge on the people glyph). */
  guestCount?: number;
  onOpenRepeat: () => void;
  onSubmit: () => void;
  voiceNotes: VoiceNote[];
  setVoiceNotes: (v: VoiceNote[]) => void;
  files: File[];
  setFiles: (v: File[]) => void;
  busy: false | "saving" | "uploading";
  onError: (message: string) => void;
  onToast: (message: string) => void;
  /** A missing team / work type / client / invitee, shown next to Save (ADR 0015 removed the summary card). */
  formError?: string;
};

/**
 * Add-task body (prototype `renderAdd`, ADR 0010/0013): title, rich description, ⟳ Repeat / files pills, "How long"
 * pills + stepper and the round voice-note mic. No date / time inputs: scheduling happens from the bottom bar (calendar
 * icon, upnext / Tom / today). No ★ Important chip, schedule line or "Goes to …" card (owner's revision, ADR 0015).
 */
export function AddTaskBody(p: Props) {
  const { form, patch, titleError, hoursError, canPickAssignees, onOpenAssignees, onOpenOptions, guestCount = 0, onOpenRepeat, onSubmit, voiceNotes, setVoiceNotes, files, setFiles, busy, onError, onToast, formError } = p;
  const editor = useRef<RichTextEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const meeting = form.type === "MEETING";
  const disabled = !!busy;

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 text-ink">
      <input
        value={form.title}
        onChange={(e) => patch({ title: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onSubmit())}
        placeholder={meeting ? "Meeting title" : "Task title"}
        aria-label="Title"
        aria-invalid={!!titleError}
        autoFocus
        maxLength={200}
        disabled={disabled}
        className="w-full border-0 bg-transparent text-[18px] font-bold tracking-[-.015em] text-ink placeholder:text-muted focus:outline-none"
      />
      {titleError ? <span className="mt-0.5 block text-[11px] text-red-500">{titleError}</span> : null}

      <RichTextEditor
        ref={editor}
        tone="plain"
        className="mt-1"
        value={form.description}
        onChange={(description) => patch({ description })}
        placeholder={meeting ? "Agenda — sent as the Calendar event description." : "Describe the work. Rich text, links and dictation."}
        minHeightClass="min-h-[72px]"
        toolbarExtra={<DictationButton compact onText={(t) => editor.current?.insertText(t)} />}
      />

      <div className="mt-2 flex flex-wrap gap-2">
        <ChipButton on={!!form.recurrence} onClick={onOpenRepeat} onClass="border-transparent bg-[#bfdbfe] text-[#0b1b2b]" label={form.recurrence ? `Repeats: ${describeRule(form.recurrence)}` : "Recurring"}>
          ⟳ {form.recurrence ? describeRule(form.recurrence) : "Recurring"}
        </ChipButton>
        {meeting ? (
          <>
            <ChipButton onClick={onOpenAssignees} label={`Guests (${guestCount})`}>
              👥 Guests · {guestCount}
            </ChipButton>
            <ChipButton onClick={() => onOpenOptions?.()} label="Meeting options">
              ⚙ Options{form.meeting?.withMeet === false ? " · no Meet" : ""}
            </ChipButton>
          </>
        ) : null}
        <ChipButton onClick={() => fileInput.current?.click()} label="Attach files">
          📎 Files{files.length ? ` · ${files.length}` : ""}
        </ChipButton>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
      </div>

      {meeting && form.meeting?.allDay ? null : (
        <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label={meeting ? "Duration" : "How long"}>
          <span className="mr-0.5 text-xs text-muted">{meeting ? "Duration" : "How long"}</span>
          {(meeting ? DURATION_PRESETS : HOUR_PRESETS).map((h) => (
            <ChipButton key={h} on={form.hours === h} onClick={() => patch({ hours: h })}>
              {meeting ? fmtDuration(h) : fmtHours(h)}
            </ChipButton>
          ))}
          <Stepper onMinus={() => patch({ hours: stepHours(form.hours, -1) })} onPlus={() => patch({ hours: stepHours(form.hours, 1) })} minusLabel="15 minutes less" plusLabel="15 minutes more">
            {meeting ? fmtDuration(form.hours) : fmtHours(form.hours)}
          </Stepper>
        </div>
      )}
      {hoursError ? <span className="mt-1 block text-[11px] text-red-500">{hoursError}</span> : null}

      {/* Meetings take no voice note: the description is the agenda (ADR 0012). */}
      {meeting ? null : <VoiceNoteRecorder notes={voiceNotes} onChange={setVoiceNotes} disabled={disabled} onError={onError} onAttached={() => onToast("Voice note attached")} />}

      {files.length ? (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Files">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex h-[26px] items-center gap-1 rounded-full border border-hair bg-chip pl-2.5 pr-1 text-[11.5px] text-ink">
              <span className="max-w-36 truncate">{f.name}</span>
              <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="flex h-5 w-5 items-center justify-center text-muted">
                <X size={11} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="pointer-events-none sticky bottom-3 mt-auto flex items-center justify-between pb-0 pt-3">
        {canPickAssignees ? (
          <button type="button" onClick={onOpenAssignees} aria-label={`Guests (${guestCount})`} className="glass pointer-events-auto relative flex h-10 w-10 items-center justify-center rounded-full text-ink">
            <Users size={20} strokeWidth={1.9} aria-hidden />
            {guestCount ? (
              <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10.5px] font-bold leading-none text-primary-ink" aria-hidden>
                {guestCount}
              </span>
            ) : null}
          </button>
        ) : (
          <span />
        )}
        {formError ? (
          <span role="alert" className="glass pointer-events-auto mx-2 min-w-0 flex-1 rounded-xl px-3 py-1.5 text-[11.5px] font-medium leading-snug text-late">
            {formError}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          aria-busy={disabled}
          className={clsx("pointer-events-auto h-10 rounded-full bg-primary px-[22px] text-sm font-semibold text-primary-ink shadow-[0_8px_24px_rgba(0,0,0,.2)] disabled:opacity-60", disabled && "animate-pulse")}
        >
          {busy === "saving" ? "Saving…" : busy === "uploading" ? "Uploading…" : meeting ? "Schedule" : "Save"}
        </button>
      </div>
    </section>
  );
}
