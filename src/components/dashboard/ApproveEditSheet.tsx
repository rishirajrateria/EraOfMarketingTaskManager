"use client";
import { useEffect, useState } from "react";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { approveProposal } from "@/server/tasks/proposals";
import { Sheet } from "@/components/ui/Sheet";
import { SheetButtons } from "@/components/ui/CloseX";
import { Field, btnPrimary, inputCls } from "@/components/ui/Field";
import { Pill } from "@/components/ui/Pill";
import { useTaskAction } from "@/components/dashboard/useTaskAction";
import { workTypesFor } from "@/components/tasks/add-task-helpers";
import { proposerName } from "@/components/dashboard/proposal-ui";
import { approvedToast } from "@/components/dashboard/proposal-toast";

type Draft = {
  title: string;
  description: string;
  clientId: string;
  workTypeId: string;
  allocatedMinutes: number;
  priority: TaskRow["priority"];
  /** The Team Leader's preferred day (a deadline's due day) and optional start time, as asked. */
  date: string;
  time: string;
};

const draftOf = (t: TaskRow): Draft => ({
  title: t.title,
  description: t.description,
  clientId: t.client.id,
  workTypeId: t.workTypeId ?? "",
  allocatedMinutes: t.allocatedMinutes || 60,
  priority: t.priority,
  date: t.proposal?.requestedDate ?? "",
  time: t.proposal?.requestedTime ?? "",
});

/**
 * Edit & approve (ADR 0021, prototype `editAndApprove`): the add / edit form prefilled with the proposal; the final
 * button reads "Approve". Saving approves it — at the (edited) preferred time when still free, else the next free slot.
 */
export function ApproveEditSheet({ task, data, open, onClose }: { task: TaskRow | null; data: DashboardData; open: boolean; onClose: () => void }) {
  const { run, busy, toast } = useTaskAction();
  const [d, setD] = useState<Draft | null>(null);
  useEffect(() => {
    if (open && task) setD(draftOf(task));
  }, [open, task]);
  if (!task || !d) return null;
  const t = task;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD({ ...d, [k]: v });
  const works = workTypesFor(data.workTypes, t.teams.map((x) => x.id));
  const dl = !!t.deadlineOnly;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dl && !d.date) return toast("Pick the due date", "err");
    const res = await run(
      approveProposal(t.id, {
        title: d.title,
        description: d.description,
        clientId: d.clientId,
        ...(d.workTypeId ? { tagIds: [d.workTypeId] } : {}),
        ...(dl ? {} : { allocatedMinutes: d.allocatedMinutes }),
        priority: d.priority,
        requestedDate: d.date || null,
        requestedTime: dl || !d.date ? null : d.time || null,
      }),
      "",
    );
    if (res !== null) {
      toast(approvedToast(res, dl, data.tz));
      onClose();
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={`Edit & approve · ${proposerName(t, data.people)}'s proposal`} full>
      <form onSubmit={submit} className="space-y-3 px-4 pb-10 pt-3">
        <Field label="Title">
          <input value={d.title} onChange={(e) => set("title", e.target.value)} className={inputCls} required maxLength={200} />
        </Field>
        <Field label="Description">
          <textarea rows={4} value={d.description} onChange={(e) => set("description", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Client">
          <select value={d.clientId} onChange={(e) => set("clientId", e.target.value)} className={inputCls} required>
            {[...(data.clients.some((c) => c.id === t.client.id) ? [] : [t.client]), ...data.clients].map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Work type">
          <div className="flex flex-wrap gap-1.5">
            {works.map((w) => (
              <Pill key={w.id} tone="outline" active={d.workTypeId === w.id} onClick={() => set("workTypeId", w.id)}>
                {w.name}
              </Pill>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={dl ? "Done by" : "Preferred day"} hint={dl ? "No hours — nothing is blocked in the day." : "Empty = the next free slot."}>
            <input type="date" value={d.date} onChange={(e) => set("date", e.target.value)} className={inputCls} required={dl} />
          </Field>
          {dl ? null : (
            <Field label="Preferred time" hint="Used if still free">
              <input type="time" step={300} value={d.time} disabled={!d.date} onChange={(e) => set("time", e.target.value)} className={inputCls} />
            </Field>
          )}
          {dl ? null : (
            <Field label="Allocated (minutes)">
              <input type="number" min={5} step={5} value={d.allocatedMinutes} onChange={(e) => set("allocatedMinutes", Math.max(5, Number(e.target.value) || 0))} className={inputCls} />
            </Field>
          )}
          <Field label="Priority">
            <select value={d.priority} onChange={(e) => set("priority", e.target.value as Draft["priority"])} className={inputCls}>
              {(["LOW", "NORMAL", "HIGH", "URGENT"] as const).map((p) => (
                <option key={p} value={p}>
                  {p.toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <SheetButtons className="pt-2">
          <button type="submit" className={btnPrimary} disabled={busy || !d.title.trim() || !d.clientId}>
            Approve
          </button>
        </SheetButtons>
      </form>
    </Sheet>
  );
}
