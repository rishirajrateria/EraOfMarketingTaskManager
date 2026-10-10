"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DashboardData, DashboardFilters, TaskRow } from "@/server/tasks/types";
import { completeFromMySide, pauseTask, raiseDoubt, raiseReviewRequest, rejectFinish, requestFixSelfTask, resolveDoubt, restartTask, resumeTask, startTask } from "@/server/tasks/lifecycle";
import { assignExecutives, deleteTask, retryIntegrations, saveFilters } from "@/server/tasks/manage";
import { PendingCommits, UNDO_MS, circleTapAction } from "@/server/tasks/circle";
import { useLiveEvents } from "@/components/shell/useLiveEvents";
import { AddTaskSheet } from "@/components/tasks/AddTaskSheet";
import { applyFilters } from "@/components/dashboard/filters";
import { ATTACHMENTS_ANCHOR } from "@/components/dashboard/format";
import { useTaskAction } from "@/components/dashboard/useTaskAction";
import { TimeStatus } from "@/components/dashboard/TimeStatus";
import { DashboardTopBar, type TopBarUser } from "@/components/dashboard/DashboardTopBar";
import { TaskList } from "@/components/dashboard/TaskList";
import { BottomBar, type AddMode } from "@/components/dashboard/BottomBar";
import { useFabRunner } from "@/components/dashboard/useFabRunner";
import { TaskActionSheet, NOTE_PROMPTS, type NoteKind, type SimpleAction } from "@/components/dashboard/TaskActionSheet";
import { TaskDetailSheet } from "@/components/dashboard/TaskDetailSheet";
import { DeleteTaskSheet } from "@/components/dashboard/DeleteTaskSheet";
import { EditTaskSheet } from "@/components/dashboard/EditTaskSheet";
import { NoteSheet } from "@/components/dashboard/NoteSheet";
import { AssignExecutiveSheet } from "@/components/dashboard/AssignExecutiveSheet";
import { PillReviewSheet, type PillReviewChoice } from "@/components/dashboard/PillReviewSheet";
import { PauseAllSheet } from "@/components/dashboard/PauseAllSheet";
import { summaryCaption } from "@/components/dashboard/summary";
import { ContactSheet } from "@/components/dashboard/ContactSheet";
import type { ContactMode } from "@/components/dashboard/contacts";
import { FLASH_MS, OPEN_AFTER_MS, planDeepLink, strippedDashboardUrl } from "@/components/dashboard/deep-link";
import { pauseResumeMany } from "@/server/tasks/bulk";
import { requestPillReview, resolvePillReview, withdrawPillReview } from "@/server/tasks/review";
import { REVIEW_FIELD_NAME, type ReviewField } from "@/server/tasks/review-fields";

const SAVE_DEBOUNCE_MS = 800;
/**
 * Client root of the dashboard (SPEC §5): cyan pill area (with the slim overlay top bar — the app header is hidden
 * on /dashboard), task list, filter strip, glass filter rows, bottom bar + all sheets. Data comes from the RSC page.
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
  const [detailId, setDetailId] = useState<string | null>(null);
  const [scrollToAttachments, setScrollToAttachments] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: NoteKind; taskId: string } | null>(null);
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  // The "+" speed dial and the add-task icon strip: Task / Meeting → add sheet, Admin shortcuts → their screens.
  const fab = useFabRunner(setAddMode);
  // Review per pill (ADR 0015): the pill menu, then (Team Leader / Executive) the note for the request.
  const [pill, setPill] = useState<{ taskId: string; field: ReviewField } | null>(null);
  const [pillNote, setPillNote] = useState<{ taskId: string; field: ReviewField } | null>(null);
  const [pauseAllOpen, setPauseAllOpen] = useState(false);
  const [contact, setContact] = useState<{ taskId: string; mode: ContactMode } | null>(null);

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

  // Deep link `?task=<id>` (ADR 0017): scroll to the card, flash it, open its (i) sheet; strip the param once consumed.
  const listRef = useRef({ byId, tasks });
  listRef.current = { byId, tasks };
  useEffect(() => {
    if (!initialTaskId) return;
    window.history.replaceState(window.history.state, "", strippedDashboardUrl(window.location.pathname, window.location.search));
    const { byId: known, tasks: shown } = listRef.current;
    const plan = planDeepLink(initialTaskId, new Set(known.keys()), new Set(shown.map((t) => t.id)));
    if (!plan) return;
    if (plan.kind === "missing") return void toast("That task is no longer on your list", "err");
    if (!plan.flash) return void setDetailId(initialTaskId);
    const card = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(initialTaskId)}"]`);
    card?.scrollIntoView({ block: "center" });
    card?.classList.add("task-flash");
    const open = setTimeout(() => setDetailId(initialTaskId), OPEN_AFTER_MS);
    const unflash = setTimeout(() => card?.classList.remove("task-flash"), FLASH_MS);
    return () => {
      clearTimeout(open);
      clearTimeout(unflash);
      card?.classList.remove("task-flash");
    };
  }, [initialTaskId, toast]);

  // Completion circle (ADR 0015): a tap is committed after the Undo window; Undo cancels it. Pending taps show ticked.
  const commits = useMemo(() => new PendingCommits(), []);
  const inFlight = useRef(new Set<string>());
  const [pendingDone, setPendingDone] = useState<ReadonlySet<string>>(() => new Set());
  const setPending = useCallback((id: string, on: boolean) => {
    setPendingDone((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  // Fresh data: forget ticks that are neither waiting for Undo nor being sent.
  useEffect(() => {
    setPendingDone((prev) => {
      const keep = [...prev].filter((id) => commits.has(id) || inFlight.current.has(id));
      return keep.length === prev.size ? prev : new Set(keep);
    });
  }, [data.tasks, commits]);
  // Leaving the page sends what is still waiting for Undo.
  useEffect(() => {
    const flush = () => commits.flushAll();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [commits]);

  const onCircle = useCallback(
    (t: TaskRow) => {
      if (commits.cancel(t.id)) {
        // Tapping a pending tick again is an undo, as in Google Tasks.
        setPending(t.id, false);
        return toast("Undone");
      }
      const action = circleTapAction(data.role, { status: t.status, assigneeIds: t.assignees.map((a) => a.id) }, data.me.id);
      if (action.kind === "none") return toast(action.message);
      setPending(t.id, true);
      commits.schedule(t.id, () => {
        inFlight.current.add(t.id);
        void run(completeFromMySide(t.id), "").then((res) => {
          inFlight.current.delete(t.id);
          if (res === null) setPending(t.id, false);
        });
      });
      toast(action.toast, "ok", {
        ms: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            if (commits.cancel(t.id)) setPending(t.id, false);
          },
        },
      });
    },
    [commits, data.role, data.me.id, run, setPending, toast],
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
        case "done":
          return onCircle(t);
        case "pause":
          return void run(pauseTask(t.id), "Task paused");
        case "resume":
          return void run(resumeTask(t.id), "Task resumed");
        case "restart":
          return onRestart(t);
        case "resolve_doubt":
          return void run(resolveDoubt(t.id), "Doubt resolved");
        case "retry":
          return onRetry(t);
        case "edit":
          return setEditId(t.id);
        case "delete":
          return setDeleteId(t.id);
        case "details":
          return setDetailId(t.id);
        case "assign":
          return setAssignId(t.id);
      }
    },
    [run, onRestart, onRetry, onCircle],
  );

  const onPillPick = useCallback(
    (choice: PillReviewChoice, t: TaskRow, field: ReviewField) => {
      const name = REVIEW_FIELD_NAME[field];
      switch (choice) {
        case "request":
          return setPillNote({ taskId: t.id, field });
        case "withdraw":
          return void run(withdrawPillReview(t.id, field), `Review of the ${name} withdrawn`);
        case "resolve":
          return void run(resolvePillReview(t.id, field), `The ${name} is reviewed`);
        case "flag":
          return void run(requestPillReview(t.id, field, ""), `The ${name} is flagged for review`);
        case "change":
          return setEditId(t.id);
        case "actions":
          return setActionId(t.id);
      }
    },
    [run],
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

  const confirmDelete = async () => {
    if (!deleteId) return;
    const id = deleteId;
    commits.cancel(id);
    const res = await run(deleteTask(id), "Task and everything with it deleted");
    if (res !== null) {
      setDeleteId(null);
      if (detailId === id) setDetailId(null);
      if (res.warnings.length) toast(`Some Google items need a manual check: ${res.warnings.join("; ")}`, "err", { ms: 8000 });
    }
  };

  const assign = async (t: TaskRow, userIds: string[]) => {
    const names = userIds.map((id) => (data.people.find((p) => p.id === id)?.name ?? "?").split(" ")[0]).join(", ");
    const res = await run(assignExecutives(t.id, userIds), `Assigned to ${names}`);
    if (res !== null) setAssignId(null);
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
        pendingDone={pendingDone}
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
          onPillMenu: (t, field) => setPill({ taskId: t.id, field }),
          onContact: (t, mode) => setContact({ taskId: t.id, mode }),
        }}
      />
      <BottomBar data={data} filters={filters} onChange={setFilters} onPick={fab.run} onPauseAll={() => setPauseAllOpen(true)} user={user} unread={unread} openRequests={openRequests} />

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
      {data.role === "ADMIN" ? (
        <PauseAllSheet
          open={pauseAllOpen}
          shown={pauseAllOpen ? applyFilters(data.tasks, { ...filters, completed: false }, { role: data.role, meId: data.me.id, tz: data.tz, nextLeaveKey: data.nextLeaveKey }) : []}
          scope={summaryCaption(data, filters) === "all tasks" ? "all open tasks" : summaryCaption(data, filters)}
          busy={busy}
          onClose={() => setPauseAllOpen(false)}
          onRun={async (action, taskIds, reason) => {
            const res = await run(pauseResumeMany({ taskIds, action, reason }), "");
            if (res) {
              setPauseAllOpen(false);
              toast(`${action === "PAUSE" ? "Paused" : "Resumed"} ${res.changed} task${res.changed === 1 ? "" : "s"}${res.skipped ? ` · ${res.skipped} skipped` : ""}`);
            }
          }}
        />
      ) : null}
      <ContactSheet task={contact ? byId.get(contact.taskId) ?? null : null} mode={contact?.mode ?? null} data={data} onClose={() => setContact(null)} />
      <PillReviewSheet task={pill ? byId.get(pill.taskId) ?? null : null} field={pill?.field ?? null} data={data} onPick={onPillPick} onClose={() => setPill(null)} />
      <NoteSheet
        open={!!pillNote && byId.has(pillNote.taskId)}
        title={pillNote ? `Review the ${REVIEW_FIELD_NAME[pillNote.field]} · ${byId.get(pillNote.taskId)?.title ?? ""}` : ""}
        placeholder="What should Admin look at? (optional)"
        required={false}
        busy={busy}
        onSubmit={async (text) => {
          if (!pillNote) return;
          const { taskId, field } = pillNote;
          setPillNote(null);
          await run(requestPillReview(taskId, field, text), `Review of the ${REVIEW_FIELD_NAME[field]} requested`);
        }}
        onClose={() => setPillNote(null)}
      />
      <DeleteTaskSheet task={deleteId ? byId.get(deleteId) ?? null : null} open={!!deleteId} busy={busy} onConfirm={confirmDelete} onClose={() => setDeleteId(null)} />
      <AssignExecutiveSheet task={assignId ? byId.get(assignId) ?? null : null} data={data} open={!!assignId} busy={busy} onClose={() => setAssignId(null)} onAssign={assign} />
      <EditTaskSheet task={editId ? byId.get(editId) ?? null : null} data={data} open={!!editId} onClose={() => setEditId(null)} />
      <AddTaskSheet open={addMode !== null} mode={addMode} onClose={() => setAddMode(null)} data={data} onPick={fab.run} />
      {fab.sheet}
    </div>
  );
}
