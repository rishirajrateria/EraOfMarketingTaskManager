"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardData, DashboardFilters, TaskRow } from "@/server/tasks/types";
import { approveFinish, pauseTask, raiseDoubt, raiseReviewRequest, rejectFinish, requestFinish, requestFixSelfTask, resolveDoubt, restartTask, resumeTask, startTask } from "@/server/tasks/lifecycle";
import { deleteTask, retryIntegrations, saveFilters, setTaskProtected } from "@/server/tasks/manage";
import { useLiveEvents } from "@/components/shell/useLiveEvents";
import { AddTaskSheet } from "@/components/tasks/AddTaskSheet";
import { applyFilters } from "@/components/dashboard/filters";
import { ATTACHMENTS_ANCHOR } from "@/components/dashboard/format";
import { useTaskAction } from "@/components/dashboard/useTaskAction";
import { TimeStatus } from "@/components/dashboard/TimeStatus";
import { DashboardTopBar, type TopBarUser } from "@/components/dashboard/DashboardTopBar";
import { TaskList } from "@/components/dashboard/TaskList";
import { BottomBar, type AddMode } from "@/components/dashboard/BottomBar";
import { TaskActionSheet, NOTE_PROMPTS, type NoteKind, type SimpleAction } from "@/components/dashboard/TaskActionSheet";
import { TaskDetailSheet } from "@/components/dashboard/TaskDetailSheet";
import { DeleteTaskSheet, type DeleteOptions } from "@/components/dashboard/DeleteTaskSheet";
import { EditTaskSheet } from "@/components/dashboard/EditTaskSheet";
import { NoteSheet } from "@/components/dashboard/NoteSheet";
import { DatePickerSheet } from "@/components/dashboard/DatePickerSheet";

const SAVE_DEBOUNCE_MS = 800;
/**
 * Client root of the dashboard (SPEC §5): cyan pill area (with the slim overlay top bar — the app header is hidden
 * on /dashboard), task list, white filter strip, green area, bottom bar + all sheets. Data comes from the RSC page.
 */
export function Dashboard({
  data,
  filters: initialFilters,
  initialTaskId,
  showCompleted,
  user,
  unread,
  openRequests,
}: {
  data: DashboardData;
  filters: DashboardFilters;
  initialTaskId: string | null;
  showCompleted: boolean;
  user: TopBarUser;
  unread: number;
  openRequests: number;
}) {
  const router = useRouter();
  const { run, busy, refresh, toast } = useTaskAction();
  const [filters, setFilters] = useState<DashboardFilters>(() => (showCompleted ? { ...initialFilters, completed: true } : initialFilters));
  const [detailId, setDetailId] = useState<string | null>(initialTaskId);
  const [scrollToAttachments, setScrollToAttachments] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: NoteKind; taskId: string } | null>(null);
  const [dateOpen, setDateOpen] = useState(false);
  const [addMode, setAddMode] = useState<AddMode | null>(null);

  const byId = useMemo(() => new Map(data.tasks.map((t) => [t.id, t])), [data.tasks]);
  const tasks = useMemo(() => applyFilters(data.tasks, filters, { role: data.role, meId: data.me.id, tz: data.tz, nextLeaveKey: data.nextLeaveKey }), [data, filters]);

  // Persist filters per user (debounced; skip the initial render).
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const h = setTimeout(() => void saveFilters(filters), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(h);
  }, [filters]);

  // Real-time list updates (SPEC §14).
  useLiveEvents((e) => {
    if (e.type === "task.changed" || e.type === "task.deleted") refresh();
  });

  // Mic icon: once the detail sheet is open, bring the attachments block into view.
  useEffect(() => {
    if (!scrollToAttachments || !detailId) return;
    const h = requestAnimationFrame(() => document.getElementById(ATTACHMENTS_ANCHOR)?.scrollIntoView({ block: "start" }));
    setScrollToAttachments(false);
    return () => cancelAnimationFrame(h);
  }, [scrollToAttachments, detailId]);

  // Deep link `?task=<id>`: strip the param once consumed so a refresh does not re-open it.
  useEffect(() => {
    if (initialTaskId && typeof window !== "undefined" && window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [initialTaskId]);

  const onCircle = useCallback(
    (t: TaskRow) => {
      if (data.role === "EXECUTIVE") return toast("Ask your Team Leader to finish");
      if (t.status === "STARTED") return void run(requestFinish(t.id), "Finish requested");
      if (t.status === "FINISH_REQUESTED") {
        if (data.role === "ADMIN") return void run(approveFinish(t.id), "Task completed");
        return toast("Waiting for Admin approval");
      }
      if (t.paused) return toast("Task is paused by Admin");
      toast("Long-press the row and choose Start first");
    },
    [data.role, run, toast],
  );

  const onRestart = useCallback(
    (t: TaskRow) => {
      if (data.role === "EXECUTIVE") return toast("Ask your Team Leader to restart");
      void run(restartTask(t.id), "Task restarted as a new copy");
    },
    [data.role, run, toast],
  );

  const onRetry = useCallback((t: TaskRow) => void run(retryIntegrations(t.id), "Retrying Google integrations"), [run]);

  const onAction = useCallback(
    (a: SimpleAction, t: TaskRow) => {
      switch (a) {
        case "start":
          return void run(startTask(t.id), "Task started");
        case "request_finish":
          return void run(requestFinish(t.id), "Finish requested");
        case "approve_finish":
          return void run(approveFinish(t.id), "Task completed");
        case "pause":
          return void run(pauseTask(t.id), "Task paused");
        case "resume":
          return void run(resumeTask(t.id), "Task resumed");
        case "restart":
          return onRestart(t);
        case "resolve_doubt":
          return void run(resolveDoubt(t.id), "Doubt resolved");
        case "protect":
          return void run(setTaskProtected(t.id, true), "Task protected");
        case "unprotect":
          return void run(setTaskProtected(t.id, false), "Task unprotected");
        case "retry":
          return onRetry(t);
        case "edit":
          return setEditId(t.id);
        case "delete":
          return setDeleteId(t.id);
        case "details":
          return setDetailId(t.id);
      }
    },
    [run, onRestart, onRetry],
  );

  const submitNote = async (text: string) => {
    if (!note) return;
    const { kind, taskId } = note;
    setNote(null);
    const call = {
      reject: () => rejectFinish(taskId, text),
      doubt: () => raiseDoubt(taskId, text),
      review: () => raiseReviewRequest(taskId, "REVIEW", text),
      time_change: () => raiseReviewRequest(taskId, "TIME_CHANGE", text),
      fix_self: () => requestFixSelfTask(taskId, text),
    }[kind];
    await run(call(), NOTE_PROMPTS[kind].success);
  };

  const confirmDelete = async (opts: DeleteOptions) => {
    if (!deleteId) return;
    const id = deleteId;
    const res = await run(deleteTask(id, opts), "Task deleted");
    if (res !== null) {
      setDeleteId(null);
      if (detailId === id) setDetailId(null);
    }
  };

  const detailTask = detailId ? byId.get(detailId) ?? null : null;
  const actionTask = actionId ? byId.get(actionId) ?? null : null;
  const noteTask = note ? byId.get(note.taskId) ?? null : null;

  return (
    <div className="flex h-[100dvh] flex-col">
      <TimeStatus data={data} filters={filters} onChange={setFilters} topBar={<DashboardTopBar user={user} unread={unread} openRequests={openRequests} />} />
      <TaskList
        tasks={tasks}
        data={data}
        refreshing={busy}
        onRefresh={refresh}
        handlers={{
          onOpen: (t) => setDetailId(t.id),
          onOpenAttachments: (t) => {
            setDetailId(t.id);
            setScrollToAttachments(true);
          },
          onLongPress: (t) => setActionId(t.id),
          onCircle,
          onRestart,
          onRetry,
        }}
      />
      <BottomBar data={data} filters={filters} onChange={setFilters} onOpenDate={() => setDateOpen(true)} onAdd={setAddMode} />

      <TaskDetailSheet
        task={detailTask}
        data={data}
        open={!!detailTask}
        onClose={() => setDetailId(null)}
        onActions={(t) => setActionId(t.id)}
        onOpenTask={(id) => {
          if (byId.has(id)) setDetailId(id);
          else router.push(`/dashboard?task=${id}&completed=1`);
        }}
      />
      <TaskActionSheet task={actionTask} data={data} open={!!actionTask} onClose={() => setActionId(null)} onAction={onAction} onNote={(kind, t) => setNote({ kind, taskId: t.id })} />
      <NoteSheet
        open={!!note && !!noteTask}
        title={note ? `${NOTE_PROMPTS[note.kind].title} · ${noteTask?.title ?? ""}` : ""}
        placeholder={note ? NOTE_PROMPTS[note.kind].placeholder : undefined}
        busy={busy}
        onSubmit={submitNote}
        onClose={() => setNote(null)}
      />
      <DeleteTaskSheet task={deleteId ? byId.get(deleteId) ?? null : null} open={!!deleteId} busy={busy} onConfirm={confirmDelete} onClose={() => setDeleteId(null)} />
      <EditTaskSheet task={editId ? byId.get(editId) ?? null : null} data={data} open={!!editId} onClose={() => setEditId(null)} />
      <DatePickerSheet open={dateOpen} value={filters.date} tz={data.tz} onChange={(date) => setFilters({ ...filters, date })} onClose={() => setDateOpen(false)} />
      <AddTaskSheet open={addMode !== null} mode={addMode} onClose={() => setAddMode(null)} data={data} />
    </div>
  );
}
