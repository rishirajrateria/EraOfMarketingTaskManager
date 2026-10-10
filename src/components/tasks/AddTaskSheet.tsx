"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { JSX } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import type { DashboardData } from "@/server/tasks/types";
import { describeRule } from "@/server/tasks/repeat-rule";
import { addTaskInventory, createTask } from "@/server/tasks/create";
import { uploadAttachment } from "@/server/tasks/manage";
import { AddTaskHeader } from "@/components/tasks/AddTaskHeader";
import { AddTaskBody } from "@/components/tasks/AddTaskBody";
import { AddTaskBottomBar, type Shortcut } from "@/components/tasks/AddTaskFooter";
import { AddTaskGreenRows } from "@/components/tasks/AddTaskRows";
import { AssigneeSheet, ScheduleSheet } from "@/components/tasks/AddTaskDetails";
import { RepeatSheet } from "@/components/tasks/RecurrencePicker";
import { MeetingGuestsSheet } from "@/components/tasks/MeetingGuestsSheet";
import { MeetingOptionsSheet } from "@/components/tasks/MeetingOptionsSheet";
import { FindTimeSheet } from "@/components/tasks/FindTimeSheet";
import { clientGuestFields, findTimeDay, guestCount, meetingShortcut, meetingTz, voiceNotesFor } from "@/components/tasks/meeting-helpers";
import type { VoiceNote } from "@/components/tasks/VoiceRecorder";
import type { FabItem } from "@/components/dashboard/fab-model";
import {
  EMPTY_LOADS,
  allowedAssignees,
  effectiveAssignees,
  emptyForm,
  hoursToMinutes,
  headerTeamIds,
  parseAddParam,
  repeatBaseDay,
  shortcutStart,
  syncWorkType,
  toTaskInput,
  validateForm,
  type AddTaskErrors,
  type AddTaskForm,
  type PeriodLoads,
  type TaskMode,
} from "@/components/tasks/add-task-helpers";

/** `onPick`: an Admin shortcut from the bottom icon strip (the sheet closes first, then the dashboard runs it). */
type Props = { open: boolean; mode: "WORK" | "MEETING" | "CHOOSE" | null; onClose: () => void; data: DashboardData; onPick?: (it: FabItem) => void };

/** Full-screen "after clicking +" sheet (SPEC §6). Creates a Work task or a Meeting via `createTask`. */
export function AddTaskSheet({ open: openProp, mode: modeProp, onClose, data, onPick }: Props): JSX.Element | null {
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
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);

  const patch = useCallback((p: Partial<AddTaskForm>) => setForm((f) => ({ ...f, ...p })), []);

  // Reset everything each time the sheet opens (or the entry mode changes while open).
  useEffect(() => {
    if (!open) return;
    // The "+" speed dial: Task opens a task, Meeting opens a meeting; the bottom Task / Meeting toggles switch later.
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
    setOptionsOpen(false);
    setFindOpen(false);
  }, [open, mode, data.me.id, data.role]);

  // WORK is single-select: auto-select the first work type of the team(s) when the current one doesn't belong.
  const teamKey = form.teamIds.join(",");
  useEffect(() => {
    setForm((f) => {
      const tagIds = syncWorkType(f, data);
      return tagIds.join(",") === f.tagIds.join(",") ? f : { ...f, tagIds };
    });
  }, [teamKey, open, data]);

  // Capacity header: hours left / booked of the selected team(s) — refreshed (debounced 300ms) when the teams change;
  // hidden while no team is known (Admin before picking a TEAM; a TL / Executive without a team).
  const headerTeams = headerTeamIds(form, data);
  const headerKey = headerTeams.join(",");
  useEffect(() => {
    if (!open || !headerTeams.length) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const res = await addTaskInventory(headerTeams).catch(() => null);
      if (cancelled || !res || !res.ok) return;
      setLoads({ ...EMPTY_LOADS, ...res.data });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, headerKey]);
  const headerName = headerTeams.length ? headerTeams.map((id) => data.teams.find((t) => t.id === id)?.name ?? "Team").join(" + ") : null;

  const assignees = useMemo(() => allowedAssignees(data, chosen ?? "WORK"), [data, chosen]);
  const meeting = chosen === "MEETING";
  const subSheetOpen = scheduleOpen || assigneesOpen || repeatOpen || optionsOpen || findOpen;
  // Meetings: the start is chosen and shown in the meeting's time zone (Options → Time zone).
  const zone = meeting ? meetingTz(form, data.tz) : data.tz;

  const choose = (type: TaskMode) => {
    if (type === chosen) return;
    setChosen(type);
    setForm((f) => ({
      ...emptyForm(type, data.me.id, data.role),
      title: f.title,
      description: f.description,
      clientId: f.clientId,
      teamIds: f.teamIds,
      tagIds: f.tagIds,
      ...clientGuestFields(type, data, f.clientId),
    }));
  };

  // Meetings: once a START time is picked, Tom / today only change the day.
  const setShortcut = (kind: Shortcut) =>
    patch({ scheduledStart: kind === "upnext" ? "" : meeting ? meetingShortcut(kind, form.scheduledStart, new Date(), zone) : shortcutStart(kind, new Date(), data.tz) });

  const uploadAll = async (taskId: string) => {
    const jobs: { file: File; kind: "FILE" | "VOICE_NOTE" | "IMAGE"; durationSec?: number }[] = [
      ...voiceNotesFor(chosen ?? "WORK", voiceNotes).map((n, i) => ({ file: new File([n.blob], `voice-note-${i + 1}.webm`, { type: n.blob.type || "audio/webm" }), kind: "VOICE_NOTE" as const, durationSec: n.durationSec })),
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

  // Missing team / work / client / invitees: shown in one line next to Save (the summary card is gone, ADR 0015).
  // Re-checked live so the line disappears as soon as the missing pick is made.
  const liveErrors = Object.keys(errors).length ? validateForm(liveForm, data) : {};
  const formError = liveErrors.teamIds ?? liveErrors.tagIds ?? liveErrors.clientId ?? liveErrors.assigneeIds;
  const guests = meeting ? guestCount(liveForm, data) : 0;
  const openFindTime = () => {
    setAssigneesOpen(false);
    setOptionsOpen(false);
    setFindOpen(true);
  };
  const repeatBase = repeatBaseDay(liveForm, new Date(), data.tz);

  return (
    <>
      <Sheet open={open} onClose={subSheetOpen ? () => undefined : close} full>
        <div className="flex h-full min-h-full flex-col" style={{ background: "var(--aurora), var(--bg)" }}>
          <AddTaskHeader loads={loads} teamName={headerName} />
          <AddTaskBody
            form={liveForm}
            patch={patch}
            titleError={errors.title}
            hoursError={errors.hours}
            canPickAssignees={canPickAssignees}
            onOpenAssignees={() => setAssigneesOpen(true)}
            onOpenOptions={() => setOptionsOpen(true)}
            guestCount={guests}
            onOpenRepeat={() => setRepeatOpen(true)}
            onSubmit={submit}
            voiceNotes={voiceNotes}
            setVoiceNotes={setVoiceNotes}
            files={files}
            setFiles={setFiles}
            busy={busy}
            onError={(m) => toast(m, "err")}
            onToast={(m) => toast(m)}
            formError={formError}
          />
          <AddTaskGreenRows form={liveForm} patch={patch} data={data} />
          <AddTaskBottomBar
            form={liveForm}
            type={chosen}
            tz={zone}
            onShortcut={setShortcut}
            onType={choose}
            onOpenSchedule={() => setScheduleOpen(true)}
            role={data.role}
            onPick={
              onPick &&
              ((it) => {
                close();
                onPick(it);
              })
            }
            onClose={close}
          />
        </div>
      </Sheet>
      <ScheduleSheet open={scheduleOpen} onClose={() => setScheduleOpen(false)} value={form.scheduledStart} tz={zone} onSet={(scheduledStart) => patch({ scheduledStart })} onError={(m) => toast(m, "err")} />
      {meeting ? (
        <>
          <MeetingGuestsSheet open={assigneesOpen} onClose={() => setAssigneesOpen(false)} form={liveForm} patch={patch} data={data} people={assignees} onFindTime={openFindTime} onError={(m) => toast(m, "err")} />
          <MeetingOptionsSheet open={optionsOpen} onClose={() => setOptionsOpen(false)} value={form.meeting} onChange={(meetingOptions) => patch({ meeting: meetingOptions })} companyTz={data.tz} onFindTime={openFindTime} />
          <FindTimeSheet
            open={findOpen}
            onClose={() => setFindOpen(false)}
            userIds={effectiveAssignees(liveForm, data)}
            initialDay={findTimeDay(liveForm, new Date(), data.tz)}
            zone={zone}
            durationMinutes={hoursToMinutes(form.hours)}
            onPick={(scheduledStart) => {
              patch({ scheduledStart });
              toast("Start time set");
            }}
            onError={(m) => toast(m, "err")}
          />
        </>
      ) : (
        <AssigneeSheet open={assigneesOpen} onClose={() => setAssigneesOpen(false)} form={liveForm} patch={patch} data={data} assignees={assignees} />
      )}
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
  if (m.includes("assign") || m.includes("invite")) return { assigneeIds: message };
  if (m.includes("allocated")) return { hours: message };
  return {};
}
