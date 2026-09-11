"use client";
import { useRef } from "react";
import { Repeat, Send, Star, Users, X } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/tasks/RichTextEditor";
import { DictationButton } from "@/components/tasks/DictationButton";
import { VoiceInputBar, VoiceNoteStrip, type VoiceNote } from "@/components/tasks/VoiceRecorder";
import type { AddTaskForm } from "@/components/tasks/add-task-helpers";

type Props = {
  form: AddTaskForm;
  patch: (p: Partial<AddTaskForm>) => void;
  titleError?: string;
  canPickAssignees: boolean;
  onOpenAssignees: () => void;
  onOpenLoop: () => void;
  onSubmit: () => void;
  voiceNotes: VoiceNote[];
  setVoiceNotes: (v: VoiceNote[]) => void;
  files: File[];
  setFiles: (v: File[]) => void;
  busy: false | "saving" | "uploading";
  onError: (message: string) => void;
};

const ICON_BTN = "flex h-9 w-9 items-center justify-center rounded-md bg-[#2B2B2B] text-white";


/** DARK BODY: star/loop column, title, rich description, assignee + send row, input bar, voice notes, file chips. */
export function AddTaskBody(p: Props) {
  const { form, patch, titleError, canPickAssignees, onOpenAssignees, onOpenLoop, onSubmit, voiceNotes, setVoiceNotes, files, setFiles, busy, onError } = p;
  const editor = useRef<RichTextEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const meeting = form.type === "MEETING";
  const disabled = !!busy;

  return (
    <section className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#1E1E1E] text-white">
      <div className="absolute right-3 top-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => patch({ important: !form.important })}
          aria-pressed={form.important}
          aria-label={form.important ? "Unmark important" : "Mark important"}
          className={clsx(ICON_BTN, form.important && "text-[#93C5FD]")}
        >
          <Star size={20} fill={form.important ? "#93C5FD" : "none"} aria-hidden />
        </button>
        {!meeting ? (
          <button type="button" onClick={onOpenLoop} aria-pressed={!!form.recurrence} aria-label="Loop (recurrence)" className={clsx(ICON_BTN, form.recurrence && "text-[#93C5FD]")}>
            <Repeat size={20} aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="px-3 pt-3">
        <input
          value={form.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Title"
          aria-label="Title"
          aria-invalid={!!titleError}
          autoFocus
          maxLength={200}
          disabled={disabled}
          className={clsx(
            "mr-12 w-[calc(100%-3rem)] border-0 border-b bg-transparent pb-2 text-base text-white placeholder:text-[#9CA3AF] focus:outline-none",
            titleError ? "border-red-500" : "border-[#3A3A3A]",
          )}
        />
        {titleError ? <span className="mt-1 block text-[11px] text-red-400">{titleError}</span> : null}
      </div>

      <div className="mt-4 px-3">
        <RichTextEditor
          ref={editor}
          tone="dark"
          value={form.description}
          onChange={(description) => patch({ description })}
          placeholder="Your paragraph text"
          minHeightClass="min-h-[190px]"
          toolbarExtra={<DictationButton compact onText={(t) => editor.current?.insertText(t)} />}
        />
      </div>

      <div className="mt-auto flex items-center justify-between px-3 pb-1 pt-3">
        {canPickAssignees ? (
          <button type="button" onClick={onOpenAssignees} aria-label={meeting ? "Choose attendees" : "Choose assignees"} className="flex h-9 w-9 items-center justify-center rounded-md">
            <Users size={28} strokeWidth={1.75} aria-hidden />
            {form.assigneeIds.length > 1 ? <span className="sr-only">{form.assigneeIds.length} selected</span> : null}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={disabled}
          aria-busy={disabled}
          aria-label={busy === "saving" ? "Saving…" : busy === "uploading" ? "Uploading…" : meeting ? "Schedule meeting" : "Create task"}
          className="flex h-9 w-9 items-center justify-center rounded-md disabled:opacity-50"
        >
          <Send size={30} strokeWidth={1.75} className={clsx(disabled && "animate-pulse")} aria-hidden />
        </button>
      </div>

      {!meeting ? (
        <>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
          <VoiceInputBar notes={voiceNotes} onChange={setVoiceNotes} onUpload={() => fileInput.current?.click()} disabled={disabled} onError={onError} />
          <VoiceNoteStrip notes={voiceNotes} onChange={setVoiceNotes} />
          {files.length ? (
            <ul className="mx-3 mb-2 flex flex-wrap gap-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex h-5 items-center gap-1 rounded-full bg-[#2B2B2B] pl-2 pr-1 text-[10px] text-[#D1D5DB]">
                  <span className="max-w-32 truncate">{f.name}</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="flex h-4 w-4 items-center justify-center text-[#9CA3AF]">
                    <X size={10} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
