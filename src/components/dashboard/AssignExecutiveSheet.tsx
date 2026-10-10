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

/** Team members offered in "Assign executive": the team's Team Leader(s) first, then its executives (ADR 0008). */
export function assignCandidates(task: TaskRow, data: Pick<DashboardData, "people" | "me" | "role">) {
  const teamIds = data.role === "TEAM_LEADER" ? (data.me.teamId ? [data.me.teamId] : []) : task.teams.map((t) => t.id);
  const inTeam = (p: DashboardData["people"][number]) => !!p.teamId && teamIds.includes(p.teamId);
  return [...data.people.filter((p) => p.role === "TEAM_LEADER" && inTeam(p)), ...data.people.filter((p) => p.role === "EXECUTIVE" && inTeam(p))];
}

/** Current executive assignees, else Admin's preferences. */
export function initialPick(task: TaskRow, data: Pick<DashboardData, "people">): string[] {
  const execs = task.assignees.filter((a) => data.people.find((p) => p.id === a.id)?.role === "EXECUTIVE").map((a) => a.id);
  return execs.length ? execs : [...task.preferredAssigneeIds];
}

/** Long-press → Assign executive: ★ = Admin's preference, ✓ = specialist in the task's work type. */
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
  const [pick, setPick] = useState<string[]>([]);
  useEffect(() => {
    if (open && task) setPick(initialPick(task, data));
  }, [open, task, data]);
  if (!task) return null;
  const t = task;
  const people = assignCandidates(t, data);
  const work = data.workTypes.find((w) => w.id === t.workTypeId)?.name ?? t.tags[0]?.name ?? "this work";
  const label = (p: (typeof people)[number]) =>
    (t.preferredAssigneeIds.includes(p.id) ? "★ " : "") +
    (p.role === "TEAM_LEADER" && p.id === data.me.id ? `me (${firstName(p.name)})` : firstName(p.name)) +
    (isSpecialist(p, t.workTypeId) ? " ✓" : "");
  const toggle = (id: string) => setPick((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Sheet open={open} onClose={onClose} title={`Assign · ${t.title}`}>
      <div className="space-y-3 px-4 py-4">
        <p className="text-xs text-gray-500">
          {t.preferredAssigneeIds.length ? `★ = Admin's preference · ✓ = specialist in ${work}. You decide.` : `Pick who does this task · ✓ = specialist in ${work}.`}
        </p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Team members">
          {people.map((p) => (
            <Pill key={p.id} tone="outline" active={pick.includes(p.id)} onClick={() => toggle(p.id)}>
              {label(p)}
            </Pill>
          ))}
          {people.length ? null : <p className="text-xs text-gray-400">Nobody in this team yet · Menu → Add executive</p>}
        </div>
        <SheetButtons className="pt-2">
          <button
            type="button"
            className={btnPrimary}
            disabled={busy}
            onClick={() => {
              if (!pick.length) return toast("Pick at least one person", "err");
              onAssign(t, pick);
            }}
          >
            Assign
          </button>
        </SheetButtons>
      </div>
    </Sheet>
  );
}
