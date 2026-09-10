"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { JSX } from "react";
import { clsx } from "@/lib/clsx";
import { Sheet } from "@/components/ui/Sheet";
import { Pill } from "@/components/ui/Pill";
import { useToast } from "@/components/ui/Toast";
import type { DashboardData } from "@/server/tasks/types";
import { createTask, periodLoads } from "@/server/tasks/create";
import { uploadAttachment } from "@/server/tasks/manage";
import { AddTaskFields, type FieldErrors } from "@/components/tasks/AddTaskFields";
import type { VoiceNote } from "@/components/tasks/VoiceRecorder";
import {
  EMPTY_LOADS,
  allowedAssignees,
  defaultTeamIds,
  emptyForm,
  fmtLoadHours,
  shortcutStart,
  toTaskInput,
  toggleId,
  validateForm,
  type AddTaskForm,
  type PeriodLoads,
  type TaskMode,
} from "@/components/tasks/add-task-helpers";

type Props = { open: boolean; mode: "WORK" | "MEETING" | "CHOOSE" | null; onClose: () => void; data: DashboardData };

const TILES: { key: keyof PeriodLoads; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tom" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

/** Full-screen "after clicking +" sheet (SPEC §6). Creates a Work task or a Meeting via `createTask`. */
export function AddTaskSheet({ open, mode, onClose, data }: Props): JSX.Element | null {
  const toast = useToast();
  const router = useRouter();
  const [chosen, setChosen] = useState<TaskMode | null>(null);
  const [form, setForm] = useState<AddTaskForm>(() => emptyForm("WORK", data.me.id));
  const [manualTime, setManualTime] = useState(false);
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [loads, setLoads] = useState<PeriodLoads>(EMPTY_LOADS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<false | "saving" | "uploading">(false);
  const teamsTouched = useRef(false);

  const patch = useCallback((p: Partial<AddTaskForm>) => setForm((f) => ({ ...f, ...p })), []);

  // Reset everything each time the sheet opens (or the entry mode changes while open).
  useEffect(() => {
    if (!open) return;
    const type: TaskMode = mode === "MEETING" ? "MEETING" : "WORK";
    setChosen(mode === "CHOOSE" ? null : type);
    setForm(emptyForm(type, data.me.id));
    setManualTime(false);
    setVoiceNotes([]);
    setFiles([]);
    setErrors({});
    setBusy(false);
    teamsTouched.current = false;
  }, [open, mode, data.me.id]);

  // Teams default to the selected assignees' teams until the user edits them by hand.
  const assigneeKey = form.assigneeIds.join(",");
  useEffect(() => {
    if (teamsTouched.current) return;
    setForm((f) => ({ ...f, teamIds: defaultTeamIds(data, f.assigneeIds) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigneeKey]);

  // Header tiles — refreshed (debounced 400ms) whenever the assignee set changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await periodLoads(form.assigneeIds).catch(() => null);
      if (cancelled || !res || !res.ok) return;
      setLoads({ ...EMPTY_LOADS, ...(res.data as Partial<PeriodLoads>) });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assigneeKey]);

  const assignees = useMemo(() => allowedAssignees(data, chosen ?? "WORK"), [data, chosen]);
  const meeting = chosen === "MEETING";

  const choose = (type: TaskMode) => {
    setChosen(type);
    setForm((f) => ({ ...emptyForm(type, data.me.id), title: f.title, description: f.description, clientId: f.clientId }));
  };

  const setShortcut = (kind: "upnext" | "tomorrow" | "today") => {
    if (kind === "upnext") {
      setManualTime(false);
      patch({ scheduledStart: "", scheduledEnd: "", acceptProposedSlot: false });
      return;
    }
    setManualTime(true);
    patch({ scheduledStart: shortcutStart(kind, new Date(), data.tz), scheduledEnd: "", acceptProposedSlot: false });
  };

  const uploadAll = async (taskId: string) => {
    const jobs: { file: File; kind: "FILE" | "VOICE_NOTE" | "IMAGE"; durationSec?: number }[] = [
      ...voiceNotes.map((n, i) => ({ file: new File([n.blob], `voice-note-${i + 1}.webm`, { type: n.blob.type || "audio/webm" }), kind: "VOICE_NOTE" as const, durationSec: n.durationSec })),
      ...files.map((file) => ({ file, kind: file.type.startsWith("image/") ? ("IMAGE" as const) : ("FILE" as const) })),
    ];
    if (!jobs.length) return;
    setBusy("uploading");
    let failed = 0;
    for (const job of jobs) {
      const fd = new FormData();
      fd.append("taskId", taskId);
      fd.append("kind", job.kind);
      if (job.durationSec) fd.append("durationSec", String(job.durationSec));
      fd.append("file", job.file);
      const res = await uploadAttachment(fd).catch(() => ({ ok: false as const, error: "upload failed" }));
      if (!res.ok) failed++;
    }
    if (failed) toast(`${failed} of ${jobs.length} attachment${jobs.length === 1 ? "" : "s"} failed to upload`, "err");
    else toast(`${jobs.length} attachment${jobs.length === 1 ? "" : "s"} uploaded`);
  };

  const submit = async () => {
    if (busy || !chosen) return;
    const errs = validateForm(form);
    setErrors(errs);
    const first = Object.values(errs)[0];
    if (first) {
      toast(first, "err");
      return;
    }
    setBusy("saving");
    try {
      const res = await createTask(toTaskInput({ ...form, type: chosen }, data.tz));
      if (!res.ok) {
        toast(res.error, "err");
        setErrors(errorsFromMessage(res.error));
        return;
      }
      toast(meeting ? "Meeting scheduled" : "Task created");
      await uploadAll(res.data.taskId);
      voiceNotes.forEach((n) => URL.revokeObjectURL(n.url));
      onClose();
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong", "err");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const startIs = (kind: "tomorrow" | "today") => !!form.scheduledStart && form.scheduledStart === shortcutStart(kind, new Date(), data.tz);

  return (
    <Sheet open={open} onClose={onClose} full>
      <div className="flex min-h-full flex-col">
        <header className="sticky top-0 z-10 bg-brand-blue px-4 pb-3 pt-3 text-white">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">{chosen === null ? "New" : meeting ? "New meeting" : "New work"}</h2>
            {chosen && mode === "CHOOSE" ? (
              <button type="button" onClick={() => setChosen(null)} className="touch-target text-xs text-white/80">
                Change type
              </button>
            ) : null}
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2" aria-label="Assignee load">
            {TILES.map((t) => (
              <div key={t.key} className="rounded-lg bg-white/15 px-2 py-2 text-center">
                <div className="text-[11px] font-medium text-white/80">{t.label}</div>
                <div className="text-xs font-bold leading-tight">{fmtLoadHours(loads[t.key].minutes)}</div>
                <div className="text-[11px] text-white/80">– {loads[t.key].count}</div>
              </div>
            ))}
          </div>
        </header>

        <main className="flex-1 px-4 py-4">
          {chosen === null ? (
            <div className="grid grid-cols-1 gap-4 py-8 sm:grid-cols-2">
              <button type="button" onClick={() => choose("WORK")} className="touch-target rounded-2xl bg-brand-blue py-8 text-xl font-bold text-white shadow-md active:bg-brand-blue-dark">
                Work
              </button>
              <button type="button" onClick={() => choose("MEETING")} className="touch-target rounded-2xl bg-brand-green py-8 text-xl font-bold text-white shadow-md active:bg-brand-green-dark">
                Meeting
              </button>
            </div>
          ) : (
            <AddTaskFields
              form={{ ...form, type: chosen }}
              patch={patch}
              data={data}
              assignees={assignees}
              errors={errors}
              manualTime={manualTime}
              setManualTime={setManualTime}
              voiceNotes={voiceNotes}
              setVoiceNotes={setVoiceNotes}
              files={files}
              setFiles={setFiles}
              onTeamsTouched={() => (teamsTouched.current = true)}
              disabled={!!busy}
            />
          )}
        </main>

        <footer className="sticky bottom-0 z-10 bg-brand-green text-white">
          {chosen !== null ? (
            <div className="space-y-1 border-b border-white/20 px-3 py-2">
              {!meeting && data.workTypes.length ? (
                <TagRow label="Work">
                  {data.workTypes.map((w) => (
                    <Pill key={w.id} active={form.tagIds.includes(w.id)} onClick={() => patch({ tagIds: toggleId(form.tagIds, w.id) })}>
                      {w.name}
                    </Pill>
                  ))}
                </TagRow>
              ) : null}
              {data.teams.length ? (
                <TagRow label="Teams">
                  {data.teams.map((t) => (
                    <Pill
                      key={t.id}
                      active={form.teamIds.includes(t.id)}
                      onClick={() => {
                        teamsTouched.current = true;
                        patch({ teamIds: toggleId(form.teamIds, t.id) });
                      }}
                    >
                      {t.name}
                    </Pill>
                  ))}
                </TagRow>
              ) : null}
              {data.clients.length ? (
                <TagRow label="Clients">
                  {data.clients.map((c) => (
                    <Pill key={c.id} active={form.clientId === c.id} onClick={() => patch({ clientId: form.clientId === c.id ? "" : c.id })}>
                      {c.name}
                    </Pill>
                  ))}
                </TagRow>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center gap-1 px-3 py-2">
            <Pill active={!form.scheduledStart} onClick={() => setShortcut("upnext")} className="touch-target" title="Next available slot">
              Upnext
            </Pill>
            <Pill active={startIs("tomorrow")} onClick={() => setShortcut("tomorrow")} className="touch-target" title="Tomorrow 10:00">
              Tom
            </Pill>
            <Pill active={startIs("today")} onClick={() => setShortcut("today")} className="touch-target" title="Today, next full hour">
              Today
            </Pill>
            <div className="flex-1" />
            <button type="button" onClick={onClose} aria-label="Cancel" className="touch-target rounded-full text-lg text-white/90 hover:bg-white/15">
              ✕
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!!busy || chosen === null}
              aria-label={meeting ? "Schedule meeting" : "Create task"}
              className={clsx("touch-target flex items-center gap-1 rounded-full bg-white px-4 text-sm font-bold text-brand-green-dark shadow disabled:opacity-60")}
            >
              {busy === "saving" ? "Saving…" : busy === "uploading" ? "Uploading…" : "Send"} <span aria-hidden>✈</span>
            </button>
          </div>
        </footer>
      </div>
    </Sheet>
  );
}

function TagRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-white/80">{label}</span>
      <div className="scrollbar-none flex flex-1 gap-1 overflow-x-auto py-0.5">{children}</div>
    </div>
  );
}

/** Map a zod / server message back onto a field so it can be highlighted inline. */
function errorsFromMessage(message: string): FieldErrors {
  const m = message.toLowerCase();
  if (m.includes("title")) return { title: message };
  if (m.includes("client")) return { clientId: message };
  if (m.includes("assign")) return { assigneeIds: message };
  if (m.includes("allocated")) return { allocatedHours: message };
  return {};
}
