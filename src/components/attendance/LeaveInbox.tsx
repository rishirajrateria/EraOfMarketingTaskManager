"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LeaveInbox as Inbox } from "@/server/leave/queries";
import { hrApprove, hrReject, resolveLeaveChange, shiftLeaveTasks } from "@/server/leave/actions";
import { btnDanger, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { clsx } from "@/lib/clsx";
import { LeaveStatusPill, fmtLeaveRange } from "@/components/attendance/LeaveList";

type Result = { ok: true; data: unknown } | { ok: false; error: string };

function Section({ title, children, empty }: { title: string; children: React.ReactNode; empty?: string }) {
  return (
    <section className="mx-3 mt-3">
      <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <div className="divide-y rounded-xl bg-white shadow-sm">{children}</div>
      {empty ? <p className="px-1 pt-1 text-xs text-gray-400">{empty}</p> : null}
    </section>
  );
}

export function LeaveInbox({ inbox, isAdmin, highlightLeaveId }: { inbox: Inbox; isAdmin: boolean; highlightLeaveId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const run = (fn: () => Promise<Result>, okText: string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return toast(r.error, "err");
      toast(okText);
      router.refresh();
    });
  const hl = (id: string) => clsx("px-4 py-3", id === highlightLeaveId && "bg-blue-50");

  return (
    <div className="pb-6">
      <Section title="Leave requests" empty={inbox.pending.length === 0 ? "Nothing pending." : undefined}>
        {inbox.pending.map((l) => (
          <div key={l.id} className={hl(l.id)}>
            <div className="text-sm font-medium">
              {l.userName} · {fmtLeaveRange(l)}
            </div>
            {l.reason ? <div className="text-xs text-gray-500">{l.reason}</div> : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                className={clsx(inputCls, "flex-1")}
                placeholder="Note (for rejection)"
                value={notes[l.id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [l.id]: e.target.value })}
              />
              <button className={btnDanger} disabled={pending} onClick={() => run(() => hrReject(l.id, notes[l.id] ?? ""), "Leave rejected")}>
                Reject
              </button>
              <button className={btnPrimary} disabled={pending} onClick={() => run(() => hrApprove(l.id), "Leave approved")}>
                Approve
              </button>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Approved leaves with affected tasks" empty={inbox.needsShift.length === 0 ? "No tasks need shifting." : undefined}>
        {inbox.needsShift.map((l) => (
          <div key={l.id} className={hl(l.id)}>
            <div className="text-sm font-medium">
              {l.userName} · {fmtLeaveRange(l)}
            </div>
            <div className="text-xs text-gray-500">
              {l.affected.length} task{l.affected.length === 1 ? "" : "s"} in this window: {l.affected.map((t) => t.title).join(", ")}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {isAdmin ? (
                <button className={btnPrimary} disabled={pending} onClick={() => run(() => shiftLeaveTasks(l.id), "Tasks shifted")}>
                  Shift all affected tasks to next available slot
                </button>
              ) : (
                <span className="text-xs text-gray-500">Admin has been asked to shift these tasks.</span>
              )}
              <Link href={`/dashboard?userId=${l.userId}`} className="text-xs text-brand-blue underline">
                reassign manually
              </Link>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Changes to approved leaves" empty={inbox.changeRequests.length === 0 ? "None pending." : undefined}>
        {inbox.changeRequests.map((c) => (
          <div key={c.requestId} className={hl(c.id)}>
            <div className="text-sm font-medium">
              {c.userName} · currently {fmtLeaveRange(c)}
            </div>
            <div className="text-xs text-gray-600">
              {"cancel" in c.payload ? "Wants to cancel this leave" : `Wants ${fmtLeaveRange(c.payload)}${c.payload.reason ? " — " + c.payload.reason : ""}`}
              <span className="text-gray-400"> · raised by {c.raisedBy}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {isAdmin ? (
                <>
                  <button className={btnSecondary} disabled={pending} onClick={() => run(() => resolveLeaveChange(c.requestId, false), "Change declined")}>
                    Decline
                  </button>
                  <button className={btnPrimary} disabled={pending} onClick={() => run(() => resolveLeaveChange(c.requestId, true), "Change applied")}>
                    Approve change
                  </button>
                </>
              ) : (
                <span className="text-xs text-gray-500">Only Admin can change an approved leave.</span>
              )}
            </div>
          </div>
        ))}
      </Section>

      <Section title="Recent" empty={inbox.recent.length === 0 ? "No history yet." : undefined}>
        {inbox.recent.map((l) => (
          <div key={l.id} className={clsx(hl(l.id), "flex items-center justify-between gap-2")}>
            <div className="min-w-0">
              <div className="truncate text-sm">
                {l.userName} · {fmtLeaveRange(l)}
              </div>
              {l.tasksShiftedAt ? <div className="text-[10px] text-gray-400">tasks shifted</div> : null}
            </div>
            <LeaveStatusPill status={l.status} />
          </div>
        ))}
      </Section>
    </div>
  );
}
