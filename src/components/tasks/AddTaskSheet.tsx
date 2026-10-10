"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { JSX } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import type { DashboardData } from "@/server/tasks/types";
import { describeRule } from "@/server/tasks/repeat-rule";
import { addTaskInventory, createTask, previewSlot } from "@/server/tasks/create";
import { uploadAttachment } from "@/server/tasks/manage";
import { AddTaskHeader } from "@/components/tasks/AddTaskHeader";
import { AddTaskBody } from "@/components/tasks/AddTaskBody";
import { AddTaskBottomBar, type Shortcut } from "@/components/tasks/AddTaskFooter";
import { AddTaskGreenRows, AddTaskSummary } from "@/components/tasks/AddTaskRows";
import { AssigneeSheet, ScheduleSheet } from "@/components/tasks/AddTaskDetails";
import { RepeatSheet } from "@/components/tasks/RecurrencePicker";
import type { VoiceNote } from "@/components/tasks/VoiceRecorder";
import {
  EMPTY_LOADS,
  allowedAssignees,
  effectiveAssignees,
  emptyForm,
  fallbackNextSlot,
  forWhom,
  hoursToMinutes,
  inventoryScope,
  parseAddParam,
  repeatBaseDay,
  scheduleLine,
  shortcutStart,
  syncWorkType,
  toTaskInput,
  validateForm,
  type AddTaskErrors,
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
  const [form, setForm] = useState<AddTaskForm>(() => emptyForm("WORK", data.me.id, data.role));
  const [voiceNotes, setVoiceNotes] = useState<VoiceNote[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [loads, setLoads] = useState<PeriodLoads>(EMPTY_LOADS);
  const [errors, setErrors] = useState<AddTaskErrors>({});
  const [busy, setBusy] = useState<false | "saving" | "uploading">(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [repeatOpen, setRepeatOpen] = useState(false);
  const [nextSlot, setNextSlot] = useState<Date | null>(null);

  const patch = useCallback((p: Partial<AddTaskForm>) => setForm((f) => ({ ...f, ...p })), []);

  // Reset everything each time the sheet opens (or the entry mode changes while open).
  useEffect(() => {
    if (!open) return;
    // "+" and "Work" open a task; the Meet icon opens a meeting. Meet / Work in the bottom bar switch later.
    const type: TaskMode = mode === "MEETING" ? "MEETING" : "WORK";
    setChosen(type);
    setForm(emptyForm(type, data.me.id, data.role));
    setVoiceNotes([]);
    setFiles([]);
    setErrors({});
    setBusy(false);
    setScheduleOpen(false);
    setAssigneesOpen(false);
    setRepeatOpen(false);
  }, [open, mode, data.me.id, data.role]);

  // WORK is single-select: auto-select the first work type of the team(s) when the current one doesn't belong.
  const teamKey = form.teamIds.join(",");
  useEffect(() => {
    setForm((f) => {
      const tagIds = syncWorkType(f, data);
      return tagIds.join(",") === f.tagIds.join(",") ? f : { ...f, tagIds };
    });
  }, [teamKey, open, data]);

  // Header pills (remaining inventory + assigned tasks) — refreshed (debounced 400ms) whenever the scope changes
  // (Admin: preferred executives, else the picked teams' executives; Team Leader: the EXEC picks, else the team).
  const scope = inventoryScope(form, data);
  const scopeKey = scope.join(",");
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await addTaskInventory(scope).catch(() => null);
      if (cancelled || !res || !res.ok) return;
      setLoads({ ...EMPTY_LOADS, ...(res.data as Partial<PeriodLoads>) });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scopeKey]);

  // "📅 Next free slot: …" — the slot the server would pick for the effective assignees (debounced 400ms).
  const slotIds = effectiveAssignees({ ...form, type: chosen ?? "WORK" }, data);
  const slotKey = `${slotIds.join(",")}|${hoursToMinutes(form.hours)}|${form.scheduledStart}`;
  useEffect(() => {
    if (!open || form.scheduledStart) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = slotIds.length ? await previewSlot(slotIds, hoursToMinutes(form.hours)).catch(() => null) : null;
      if (!cancelled) setNextSlot(res && res.ok && res.data ? new Date(res.data.start) : null);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slotKey]);

  const assignees = useMemo(() => allowedAssignees(data, chosen ?? "WORK"), [data, chosen]);
  const meeting = chosen === "MEETING";
  const subSheetOpen = scheduleOpen || assigneesOpen || repeatOpen;

  const choose = (type: TaskMode) => {
    if (type === chosen) return;
    setChosen(type);
    setForm((f) => ({ ...emptyForm(type, data.me.id, data.role), title: f.title, description: f.description, clientId: f.clientId, teamIds: f.teamIds, tagIds: f.tagIds }));
  };

  const setShortcut = (kind: Shortcut) => patch({ scheduledStart: kind === "upnext" ? "" : shortcutStart(kind, new Date(), data.tz) });

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
    const errs = validateForm({ ...form, type: chosen }, data);
    const first = Object.values(errs)[0];
    if (first) {
      toast(first, "err");
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy("saving");
    try {
      const live = { ...form, type: chosen };
      const res = await createTask(toTaskInput({ ...live, assigneeIds: effectiveAssignees(live, data) }, data.tz));
      if (!res.ok) {
        toast(res.error, "err");
        setErrors(errorsFromMessage(res.error));
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
  // Work: the green rows pick team / executives. Meetings can also invite anyone from the people glyph.
  const canPickAssignees = meeting;

  const scheduleText = scheduleLine(liveForm, forWhom(liveForm, data), nextSlot ?? fallbackNextSlot(new Date(), data.tz), new Date(), data.tz);
  const repeatBase = repeatBaseDay(liveForm, new Date(), data.tz);

  return (
    <>
      <Sheet open={open} onClose={subSheetOpen ? () => undefined : close} full>
        <div className="flex h-full min-h-full flex-col" style={{ background: "var(--aurora), var(--bg)" }}>
          <AddTaskHeader loads={loads} />
          <AddTaskBody
            form={liveForm}
            patch={patch}
            titleError={errors.title}
            hoursError={errors.hours}
            canPickAssignees={canPickAssignees}
            onOpenAssignees={() => setAssigneesOpen(true)}
            onOpenRepeat={() => setRepeatOpen(true)}
            onSubmit={submit}
            voiceNotes={voiceNotes}
            setVoiceNotes={setVoiceNotes}
            files={files}
            setFiles={setFiles}
            busy={busy}
            onError={(m) => toast(m, "err")}
            onToast={(m) => toast(m)}
            scheduleText={scheduleText}
            summary={<AddTaskSummary form={liveForm} data={data} />}
          />
          <AddTaskGreenRows form={liveForm} patch={patch} data={data} />
          <AddTaskBottomBar
            form={liveForm}
            type={chosen}
            tz={data.tz}
            onShortcut={setShortcut}
            onType={choose}
            onOpenSchedule={() => setScheduleOpen(true)}
            onClose={close}
          />
        </div>
      </Sheet>
      <ScheduleSheet open={scheduleOpen} onClose={() => setScheduleOpen(false)} value={form.scheduledStart} tz={data.tz} onSet={(scheduledStart) => patch({ scheduledStart })} onError={(m) => toast(m, "err")} />
      <AssigneeSheet open={assigneesOpen} onClose={() => setAssigneesOpen(false)} form={liveForm} patch={patch} data={data} assignees={assignees} />
      {!meeting ? (
        <RepeatSheet
          open={repeatOpen}
          onClose={() => setRepeatOpen(false)}
          value={form.recurrence}
          base={repeatBase}
          onDone={(recurrence) => {
            patch({ recurrence });
            toast(`Repeats: ${describeRule(recurrence)}`);
          }}
          onClear={form.recurrence ? () => patch({ recurrence: null }) : undefined}
        />
      ) : null}
    </>
  );
}

/** Map a zod / server message back onto a field so it can be highlighted inline. */
function errorsFromMessage(message: string): AddTaskErrors {
  const m = message.toLowerCase();
  if (m.includes("title")) return { title: message };
  if (m.includes("pick a team") || m.includes("team leader yet")) return { teamIds: message };
  if (m.includes("work type")) return { tagIds: message };
  if (m.includes("client")) return { clientId: message };
  if (m.includes("assign")) return { assigneeIds: message };
  if (m.includes("allocated")) return { hours: message };
  return {};
}
