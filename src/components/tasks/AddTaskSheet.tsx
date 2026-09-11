"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { JSX } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import type { DashboardData } from "@/server/tasks/types";
import { addTaskInventory, createTask } from "@/server/tasks/create";
import { uploadAttachment } from "@/server/tasks/manage";
import { AddTaskHeader } from "@/components/tasks/AddTaskHeader";
import { AddTaskBody } from "@/components/tasks/AddTaskBody";
import { AddTaskBottomBar, AddTaskTags, TaskTypeSheet, type Shortcut } from "@/components/tasks/AddTaskFooter";
import { AddTaskDetails, AssigneeSheet, LoopSheet, type DetailsFocus, type FieldErrors } from "@/components/tasks/AddTaskDetails";
import type { VoiceNote } from "@/components/tasks/VoiceRecorder";
import {
  EMPTY_LOADS,
  allowedAssignees,
  defaultTeamIds,
  emptyForm,
  needsDetailsSheet,
  parseAddParam,
  shortcutStart,
  toTaskInput,
  validateForm,
  type AddTaskForm,
  type PeriodLoads,
  type TaskMode,
} from "@/components/tasks/add-task-helpers";

type Props = { open: boolean; mode: "WORK" | "MEETING" | "CHOOSE" | null; onClose: () => void; data: DashboardData };

/** Full-screen "after clicking +" sheet (SPEC §6). Creates a Work task or a Meeting via `createTask`. */
export function AddTaskSheet({ open: openProp, mode: modeProp, onClose, data }: Props): JSX.Element | null {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  // `/dashboard?add=WORK|MEETING|CHOOSE` opens the sheet on mount (deep link / screenshots).
  const urlMode = parseAddParam(searchParams?.get("add"));
  const [urlOpen, setUrlOpen] = useState(false);
  useEffect(() => setUrlOpen(!!urlMode), [urlMode]);
  const open = openProp || urlOpen;
  const mode = openProp ? modeProp : urlMode;
  const close = useCallback(() => {
    setUrlOpen(false);
    onClose();
  }, [onClose]);

  const [chosen, setChosen] = useState<TaskMode | null>(null);
  const [form, setForm] = useState<AddTaskForm>(() => emptyForm("WORK", data.me.id));
  const [manualTime, setManualTime] = useState(false);
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [loads, setLoads] = useState<PeriodLoads>(EMPTY_LOADS);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<false | "saving" | "uploading">(false);
  const [details, setDetails] = useState<{ open: boolean; focus: DetailsFocus }>({ open: false, focus: null });
  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [loopOpen, setLoopOpen] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const teamsTouched = useRef(false);

  const patch = useCallback((p: Partial<AddTaskForm>) => setForm((f) => ({ ...f, ...p })), []);

  // Reset everything each time the sheet opens (or the entry mode changes while open).
  useEffect(() => {
    if (!open) return;
    // "+" and "Work" open a task; the Meet icon opens a meeting. The type icon in the bottom bar switches later.
    const type: TaskMode = mode === "MEETING" ? "MEETING" : "WORK";
    setChosen(type);
    setForm(emptyForm(type, data.me.id));
    setManualTime(false);
    setVoiceNotes([]);
    setFiles([]);
    setErrors({});
    setBusy(false);
    setDetails({ open: false, focus: null });
    setAssigneesOpen(false);
    setLoopOpen(false);
    setTypeOpen(false);
    teamsTouched.current = false;
  }, [open, mode, data.me.id]);

  // Teams default to the selected assignees' teams until the user edits them by hand.
  const assigneeKey = form.assigneeIds.join(",");
  useEffect(() => {
    if (teamsTouched.current) return;
    setForm((f) => ({ ...f, teamIds: defaultTeamIds(data, f.assigneeIds) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigneeKey]);

  // Header pills (remaining inventory + assigned tasks) — refreshed (debounced 400ms) whenever the assignee set changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await addTaskInventory(form.assigneeIds).catch(() => null);
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
  const executives = useMemo(() => allowedAssignees(data, "WORK").filter((p) => p.id !== data.me.id), [data]);
  const meeting = chosen === "MEETING";
  const subSheetOpen = details.open || assigneesOpen || loopOpen || typeOpen;

  const choose = (type: TaskMode) => {
    if (type === chosen) return;
    setChosen(type);
    setForm((f) => ({ ...emptyForm(type, data.me.id), title: f.title, description: f.description, clientId: f.clientId }));
    teamsTouched.current = false;
  };

  const setShortcut = (kind: Shortcut) => {
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

  const showErrors = (errs: FieldErrors) => {
    setErrors(errs);
    if (needsDetailsSheet(errs)) setDetails({ open: true, focus: null });
  };

  const submit = async () => {
    if (busy || !chosen) return;
    const errs = validateForm(form);
    const first = Object.values(errs)[0];
    if (first) {
      toast(first, "err");
      showErrors(errs);
      return;
    }
    setErrors({});
    setBusy("saving");
    try {
      const res = await createTask(toTaskInput({ ...form, type: chosen }, data.tz));
      if (!res.ok) {
        toast(res.error, "err");
        showErrors(errorsFromMessage(res.error));
        return;
      }
      toast(meeting ? "Meeting scheduled" : "Task created");
      await uploadAll(res.data.taskId);
      voiceNotes.forEach((n) => URL.revokeObjectURL(n.url));
      close();
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong", "err");
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const liveForm = { ...form, type: chosen ?? "WORK" };
  const canPickAssignees = data.role !== "EXECUTIVE" || meeting;

  return (
    <>
      <Sheet open={open} onClose={subSheetOpen ? () => undefined : close} full>
        <div className="flex h-full min-h-full flex-col bg-[#1E1E1E]">
          <AddTaskHeader loads={loads} />
          <AddTaskBody
              form={liveForm}
              patch={patch}
              titleError={errors.title}
              canPickAssignees={canPickAssignees}
              onOpenAssignees={() => setAssigneesOpen(true)}
              onOpenLoop={() => setLoopOpen(true)}
              onSubmit={submit}
              voiceNotes={voiceNotes}
              setVoiceNotes={setVoiceNotes}
              files={files}
              setFiles={setFiles}
              busy={busy}
              onError={(m) => toast(m, "err")}
          />
          <AddTaskTags form={liveForm} patch={patch} data={data} executives={executives} onTeamsTouched={() => (teamsTouched.current = true)} />
          <AddTaskBottomBar
            form={liveForm}
            type={chosen}
            tz={data.tz}
            onShortcut={setShortcut}
            onType={choose}
            onOpenSchedule={() => setDetails({ open: true, focus: "schedule" })}
            onOpenTypeChooser={() => setTypeOpen(true)}
            onClose={close}
          />
        </div>
      </Sheet>

      <TaskTypeSheet open={typeOpen} onClose={() => setTypeOpen(false)} type={chosen} onType={choose} />
      {chosen !== null ? (
        <>
          <AddTaskDetails
            open={details.open}
            onClose={() => setDetails({ open: false, focus: null })}
            focus={details.focus}
            form={liveForm}
            patch={patch}
            data={data}
            assignees={assignees}
            errors={errors}
            manualTime={manualTime}
            setManualTime={setManualTime}
            onTeamsTouched={() => (teamsTouched.current = true)}
            disabled={!!busy}
          />
          <AssigneeSheet open={assigneesOpen} onClose={() => setAssigneesOpen(false)} form={liveForm} patch={patch} data={data} assignees={assignees} />
          {!meeting ? <LoopSheet open={loopOpen} onClose={() => setLoopOpen(false)} value={form.recurrence} onChange={(recurrence) => patch({ recurrence })} /> : null}
        </>
      ) : null}
    </>
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
