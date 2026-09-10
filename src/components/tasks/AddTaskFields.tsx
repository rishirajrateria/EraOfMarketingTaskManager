"use client";
import { useRef } from "react";
import { clsx } from "@/lib/clsx";
import { Field, inputCls } from "@/components/ui/Field";
import type { DashboardData } from "@/server/tasks/types";
import { RichTextEditor, type RichTextEditorHandle } from "@/components/tasks/RichTextEditor";
import { DictationButton } from "@/components/tasks/DictationButton";
import { VoiceRecorder, type VoiceNote } from "@/components/tasks/VoiceRecorder";
import { RecurrencePicker } from "@/components/tasks/RecurrencePicker";
import { SlotPreview } from "@/components/tasks/SlotPreview";
import { hoursToMinutes, toggleId, type AddTaskForm, type Person } from "@/components/tasks/add-task-helpers";

export type FieldErrors = Partial<Record<"title" | "clientId" | "assigneeIds" | "allocatedHours", string>>;

type Props = {
  form: AddTaskForm;
  patch: (p: Partial<AddTaskForm>) => void;
  data: DashboardData;
  assignees: Person[];
  errors: FieldErrors;
  manualTime: boolean;
  setManualTime: (v: boolean) => void;
  voiceNotes: VoiceNote[];
  setVoiceNotes: (v: VoiceNote[]) => void;
  files: File[];
  setFiles: (v: File[]) => void;
  onTeamsTouched: () => void;
  disabled: boolean;
};

function Chip({ active, onClick, children, colour }: { active: boolean; onClick: () => void; children: React.ReactNode; colour?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "touch-target inline-flex items-center gap-1 rounded-full px-3 text-xs font-medium transition",
        active ? "bg-brand-blue text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200",
      )}
    >
      {colour ? <span className="h-2 w-2 rounded-full" style={{ background: colour }} aria-hidden /> : null}
      {children}
    </button>
  );
}

const Err = ({ text }: { text?: string }) => (text ? <span className="mt-1 block text-[11px] text-red-600">{text}</span> : null);

/** The scrolling form body of the Add-task sheet (SPEC §6 field list). */
export function AddTaskFields(p: Props) {
  const { form, patch, data, assignees, errors, manualTime, setManualTime, voiceNotes, setVoiceNotes, files, setFiles, onTeamsTouched, disabled } = p;
  const editor = useRef<RichTextEditorHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const meeting = form.type === "MEETING";
  const showTimeInputs = manualTime || !!form.scheduledStart;

  return (
    <div className="space-y-4">
      <Field label="Title">
        <input
          value={form.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder={meeting ? "Meeting title" : "What needs to be done?"}
          className={clsx(inputCls, "text-base", errors.title && "border-red-500")}
          autoFocus
          maxLength={200}
          disabled={disabled}
        />
        <Err text={errors.title} />
      </Field>

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-600">Description</span>
        <RichTextEditor
          ref={editor}
          value={form.description}
          onChange={(description) => patch({ description })}
          toolbarExtra={<DictationButton onText={(t) => editor.current?.insertText(t)} />}
        />
      </div>

      {!meeting ? (
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-600">Voice notes</span>
          <VoiceRecorder notes={voiceNotes} onChange={setVoiceNotes} disabled={disabled} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => patch({ important: !form.important })}
          aria-pressed={form.important}
          className={clsx("touch-target rounded-full px-3 text-sm font-semibold", form.important ? "bg-amber-400 text-gray-900" : "bg-gray-100 text-gray-700")}
        >
          {form.important ? "★ Important" : "☆ Star"}
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-gray-600">
          Priority
          <select value={form.priority} onChange={(e) => patch({ priority: e.target.value as AddTaskForm["priority"] })} className={clsx(inputCls, "w-auto")}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </label>
      </div>

      {!meeting ? <RecurrencePicker value={form.recurrence} onChange={(recurrence) => patch({ recurrence })} /> : null}

      {!meeting ? (
        <div>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={disabled} className="touch-target rounded-full bg-gray-100 px-3 text-sm font-semibold text-gray-700">
            📎 Upload {files.length ? `(${files.length})` : ""}
          </button>
          <p className="mt-1 text-[11px] text-gray-400">Files are uploaded into the task&apos;s Drive folder right after the task is created (the folder is created then).</p>
          {files.length ? (
            <ul className="mt-1 flex flex-wrap gap-1">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded-full bg-gray-100 py-1 pl-3 pr-1 text-xs">
                  <span className="max-w-40 truncate">{f.name}</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="touch-target text-gray-400">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Field label="Client" hint={data.clients.length ? undefined : "No clients yet — add clients in Admin → Add Client"}>
        <select value={form.clientId} onChange={(e) => patch({ clientId: e.target.value })} className={clsx(inputCls, errors.clientId && "border-red-500")} disabled={disabled}>
          <option value="">Select a client…</option>
          {data.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Err text={errors.clientId} />
      </Field>

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-600">{meeting ? "Attendees" : "Assignees"}</span>
        <div className="flex flex-wrap gap-2">
          {assignees.map((a) => (
            <Chip key={a.id} active={form.assigneeIds.includes(a.id)} onClick={() => patch({ assigneeIds: toggleId(form.assigneeIds, a.id) })}>
              {a.id === data.me.id ? `${a.name.split(" ")[0]} (me)` : a.name}
            </Chip>
          ))}
        </div>
        <Err text={errors.assigneeIds} />
      </div>

      {data.teams.length ? (
        <div>
          <span className="mb-1 block text-xs font-medium text-gray-600">Teams</span>
          <div className="flex flex-wrap gap-2">
            {data.teams.map((t) => (
              <Chip
                key={t.id}
                colour={t.colour}
                active={form.teamIds.includes(t.id)}
                onClick={() => {
                  onTeamsTouched();
                  patch({ teamIds: toggleId(form.teamIds, t.id) });
                }}
              >
                {t.name}
              </Chip>
            ))}
          </div>
        </div>
      ) : null}

      <Field label="Allocated time (hours)">
        <input
          type="number"
          inputMode="decimal"
          min={0.25}
          step={0.5}
          value={form.allocatedHours}
          onChange={(e) => patch({ allocatedHours: e.target.value })}
          className={clsx(inputCls, errors.allocatedHours && "border-red-500")}
          disabled={disabled}
        />
        <Err text={errors.allocatedHours} />
      </Field>

      <div>
        <span className="mb-1 block text-xs font-medium text-gray-600">Scheduled date &amp; time</span>
        {showTimeInputs ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="Start">
                <input type="datetime-local" value={form.scheduledStart} onChange={(e) => patch({ scheduledStart: e.target.value })} className={inputCls} disabled={disabled} />
              </Field>
              <Field label="Stop (optional)">
                <input type="datetime-local" value={form.scheduledEnd} min={form.scheduledStart || undefined} onChange={(e) => patch({ scheduledEnd: e.target.value })} className={inputCls} disabled={disabled} />
              </Field>
            </div>
            <button
              type="button"
              onClick={() => {
                setManualTime(false);
                patch({ scheduledStart: "", scheduledEnd: "", acceptProposedSlot: true });
              }}
              className="touch-target text-xs font-medium text-brand-blue"
            >
              ← Use next available slot instead
            </button>
          </div>
        ) : (
          <SlotPreview
            assigneeIds={form.assigneeIds}
            allocatedMinutes={hoursToMinutes(form.allocatedHours)}
            tz={data.tz}
            accepted={form.acceptProposedSlot}
            onAccept={() => patch({ acceptProposedSlot: true })}
            onPickManually={() => setManualTime(true)}
          />
        )}
        {meeting ? <p className="mt-1 text-[11px] text-gray-400">Meetings need a time — leave it empty to auto-pick the next slot when every attendee is free.</p> : null}
      </div>
    </div>
  );
}
