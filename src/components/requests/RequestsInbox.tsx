"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { RequestItem } from "@/server/requests/queries";
import { approveFinish, rejectFinish, resolveDoubt } from "@/server/tasks/lifecycle";
import { setTaskProtected } from "@/server/tasks/manage";
import { resolveRequest } from "@/server/requests/actions";
import { useToast } from "@/components/ui/Toast";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { Pill } from "@/components/ui/Pill";
import { fmtDateTime } from "@/lib/time";

const LABEL: Record<string, string> = {
  FINISH: "Finish request",
  DOUBT: "Doubt",
  REVIEW: "Review request",
  TIME_CHANGE: "Time-change request",
  FIX_SELF_TASK: "Fix self-assigned task",
  LEAVE: "Leave request",
  APPROVED_CHANGE: "Change to approved item",
};

const TYPES = ["ALL", "FINISH", "DOUBT", "REVIEW", "TIME_CHANGE", "FIX_SELF_TASK", "APPROVED_CHANGE"];

export function RequestsInbox({ items, showAll, tz }: { items: RequestItem[]; showAll: boolean; tz: string }) {
  const [type, setType] = useState("ALL");
  const [note, setNote] = useState<{ id: string; action: "reject" | "resolve"; taskId: string | null; type: string } | null>(null);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const visible = items.filter((r) => type === "ALL" || r.type === type);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      toast(r.ok ? "Done" : (r.error ?? "Failed"), r.ok ? "ok" : "err");
      setNote(null);
      setText("");
      router.refresh();
    });

  return (
    <main className="flex flex-1 flex-col bg-white">
      <div className="scrollbar-none flex gap-2 overflow-x-auto border-b bg-brand-blue px-3 py-2">
        {TYPES.map((t) => (
          <Pill key={t} active={type === t} onClick={() => setType(t)}>
            {t === "ALL" ? "All" : LABEL[t]}
          </Pill>
        ))}
        <Link href={showAll ? "/requests" : "/requests?all=1"} className="ml-auto shrink-0 self-center text-xs text-white/80">
          {showAll ? "Open only" : "Show resolved"}
        </Link>
      </div>
      {visible.length === 0 ? <p className="p-6 text-center text-sm text-gray-500">Inbox is empty.</p> : null}
      <ul className="divide-y">
        {visible.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase text-brand-blue">{LABEL[r.type] ?? r.type}</div>
                {r.task ? (
                  <Link href={`/dashboard?task=${r.task.id}`} className="block truncate text-sm font-medium">
                    {r.task.title} <span className="text-gray-400">· {r.task.client}</span>
                  </Link>
                ) : r.leave ? (
                  <Link href={`/requests/leave?leaveId=${r.leave.id}`} className="block text-sm font-medium">
                    {r.leave.userName}: {r.leave.from.slice(0, 10)} → {r.leave.to.slice(0, 10)}
                  </Link>
                ) : null}
                {r.note ? <div className="mt-0.5 text-xs text-gray-700">“{r.note}”</div> : null}
                <div className="mt-0.5 text-[11px] text-gray-400">
                  {r.raisedBy.name} · {fmtDateTime(new Date(r.createdAt), tz)} · {r.status}
                </div>
              </div>
            </div>
            {r.status === "OPEN" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {r.type === "FINISH" && r.task ? (
                  <>
                    <button disabled={pending} className={btnPrimary} onClick={() => run(() => approveFinish(r.task!.id))}>Approve</button>
                    <button disabled={pending} className={btnSecondary} onClick={() => setNote({ id: r.id, action: "reject", taskId: r.task!.id, type: r.type })}>Reject…</button>
                  </>
                ) : null}
                {r.type === "DOUBT" && r.task ? (
                  <>
                    <button disabled={pending} className={btnPrimary} onClick={() => setNote({ id: r.id, action: "resolve", taskId: r.task!.id, type: r.type })}>Unflag…</button>
                    {r.task ? <Link href={`/dashboard?task=${r.task.id}`} className={btnSecondary}>Open task</Link> : null}
                  </>
                ) : null}
                {(r.type === "REVIEW" || r.type === "TIME_CHANGE") && r.task ? (
                  <>
                    <Link href={`/dashboard?task=${r.task.id}&edit=1`} className={btnPrimary}>Edit task</Link>
                    <button disabled={pending} className={btnSecondary} onClick={() => run(() => resolveRequest(r.id, "RESOLVED"))}>Mark resolved</button>
                  </>
                ) : null}
                {r.type === "FIX_SELF_TASK" && r.task ? (
                  <>
                    <button disabled={pending} className={btnPrimary} onClick={() => run(() => setTaskProtected(r.task!.id, true))}>Protect task</button>
                    <button disabled={pending} className={btnSecondary} onClick={() => run(() => resolveRequest(r.id, "REJECTED"))}>Decline</button>
                  </>
                ) : null}
                {r.type === "APPROVED_CHANGE" || r.type === "LEAVE" ? (
                  <Link href={r.leave ? `/requests/leave?leaveId=${r.leave.id}` : "/requests/leave"} className={btnPrimary}>Open leave</Link>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <Sheet open={!!note} onClose={() => setNote(null)} title={note?.action === "reject" ? "Reject finish" : "Resolve doubt"}>
        <div className="space-y-3 p-4">
          <textarea className={inputCls} rows={3} placeholder="Note to the team" value={text} onChange={(e) => setText(e.target.value)} />
          <button
            disabled={pending}
            className={btnPrimary}
            onClick={() => {
              if (!note?.taskId) return;
              run(() => (note.action === "reject" ? rejectFinish(note.taskId!, text) : resolveDoubt(note.taskId!, text)));
            }}
          >
            Confirm
          </button>
        </div>
      </Sheet>
    </main>
  );
}
