"use client";
import { useEffect, useState } from "react";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { Sheet } from "@/components/ui/Sheet";
import { SheetButtons } from "@/components/ui/CloseX";
import { Pill } from "@/components/ui/Pill";
import { btnPrimary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { isSpecialist } from "@/components/tasks/add-task-helpers";
import { firstName } from "@/components/dashboard/format";

/** Team members offered in "Assign / Change person": the team's Team Leader(s) first, then its executives (ADR 0008). */
export function assignCandidates(task: TaskRow, data: Pick<DashboardData, "people" | "me" | "role">) {
  const teamIds = data.role === "TEAM_LEADER" ? (data.me.teamId ? [data.me.teamId] : []) : task.teams.map((t) => t.id);
  const inTeam = (p: DashboardData["people"][number]) => !!p.teamId && teamIds.includes(p.teamId);
  return [...data.people.filter((p) => p.role === "TEAM_LEADER" && inTeam(p)), ...data.people.filter((p) => p.role === "EXECUTIVE" && inTeam(p))];
}

/**
 * The one person pre-selected (single select, ADR 0021 / prototype `assignSheet`): the executive on the task, else
 * whoever of the candidates holds it, else Admin's first preference, else the Team Leader.
 */
export function initialPick(task: TaskRow, data: Pick<DashboardData, "people" | "me" | "role">): string | null {
  const pool = assignCandidates(task, data);
  const inPool = (id: string) => pool.some((p) => p.id === id);
  const roleOf = (id: string) => data.people.find((p) => p.id === id)?.role;
  const held = task.assignees.map((a) => a.id).filter(inPool);
  return held.find((id) => roleOf(id) === "EXECUTIVE") ?? held[0] ?? task.preferredAssigneeIds.find(inPool) ?? pool[0]?.id ?? null;
}

/** Long-press → Assign / Change person: one pick — another executive, or back to the Team Leader. ★ preference · ✓ specialist. */
export function AssignExecutiveSheet({
  task,
  data,
  open,
  busy,
  onClose,
  onAssign,
}: {
  task: TaskRow | null;
  data: DashboardData;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onAssign: (task: TaskRow, userIds: string[]) => void;
}) {
  const toast = useToast();
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    if (open && task) setPick(initialPick(task, data));
  }, [open, task, data]);
  if (!task) return null;
  const t = task;
  const people = assignCandidates(t, data);
  const now = t.assignees.map((a) => firstName(a.name)).join(", ") || "nobody";
  const label = (p: (typeof people)[number]) =>
    (p.id === data.me.id ? "me" : p.role === "TEAM_LEADER" ? `${firstName(p.name)} (TL)` : firstName(p.name)) +
    (t.preferredAssigneeIds.includes(p.id) ? " ★" : "") +
    (isSpecialist(p, t.workTypeId) ? " ✓" : "");

  return (
    <Sheet open={open} onClose={onClose} title={`Assign / Change person · ${t.title}`}>
      <div className="space-y-3 px-4 py-4">
        <p className="text-xs text-muted">Now with {now}. Pick one person: another executive, or back to the Team Leader. ★ Admin&apos;s preference · ✓ specialist.</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Team members">
          {people.map((p) => (
            <Pill key={p.id} tone="outline" active={pick === p.id} onClick={() => setPick(p.id)}>
              {label(p)}
            </Pill>
          ))}
          {people.length ? null : <p className="text-xs text-muted">Nobody in this team yet · Menu → Add executive</p>}
        </div>
        <SheetButtons className="pt-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={() => {
              if (!pick) return toast("Pick a person", "err");
              const name = firstName(people.find((p) => p.id === pick)?.name ?? "");
              if (t.assignees.length === 1 && t.assignees[0]!.id === pick) {
                onClose();
                return toast(`Already with ${name}`);
              }
              onAssign(t, [pick]);
            }}
          >
            Assign
          </button>
        </SheetButtons>
      </div>
    </Sheet>
  );
}
