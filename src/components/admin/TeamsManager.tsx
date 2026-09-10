"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, inputCls, btnSecondary } from "@/components/ui/Field";
import { ColourDot, ColourInput, EmptyState, Fab, FormFooter, ListRow, ScreenHeader, StatusPill, useAdminAction } from "@/components/admin/AdminUi";
import { createTeam, setTeamActive, updateTeam } from "@/server/admin/actions";
import type { LeaderOption, TeamRow } from "@/server/admin/queries";
import type { TeamInput } from "@/server/admin/schemas";

/** /admin/teams — "Add Designation" (SPEC §11.8). Designation = Team. */
export function TeamsManager({ teams, leaders }: { teams: TeamRow[]; leaders: LeaderOption[] }) {
  const { busy, run } = useAdminAction();
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    setEditing(null);
  };

  const submit = async (values: TeamInput) => {
    const res = editing ? await run(updateTeam({ ...values, id: editing.id }), "Saved") : await run(createTeam(values), "Designation added");
    if (res) close();
  };
  const toggle = async (t: TeamRow) => {
    const res = await run(setTeamActive(t.id, !t.active), t.active ? "Deactivated" : "Activated");
    if (res) close();
  };

  return (
    <div className="flex flex-1 flex-col pb-24">
      <ScreenHeader title="Add Designation" subtitle="Teams such as Graphic, Finance, Website, Video, Write" />
      {teams.length === 0 ? <EmptyState>No designations yet. Tap ＋ to add one.</EmptyState> : null}
      {teams.map((t) => (
        <ListRow
          key={t.id}
          title={t.name}
          subtitle={`${t.leader ? `Lead: ${t.leader.name}` : "No leader"} · ${t._count.members} member${t._count.members === 1 ? "" : "s"}`}
          leading={<ColourDot colour={t.colour} size={14} />}
          trailing={<StatusPill active={t.active} />}
          inactive={!t.active}
          onClick={() => {
            setEditing(t);
            setOpen(true);
          }}
        />
      ))}
      <Fab onClick={() => setOpen(true)} label="Add designation" />
      <Sheet open={open} onClose={close} title={editing ? "Edit designation" : "Add designation"}>
        {open ? (
          <TeamForm key={editing?.id ?? "new"} team={editing} leaders={leaders} busy={busy} onSubmit={submit} onCancel={close} onToggle={editing ? () => toggle(editing) : undefined} />
        ) : null}
      </Sheet>
    </div>
  );
}

function TeamForm({
  team,
  leaders,
  busy,
  onSubmit,
  onCancel,
  onToggle,
}: {
  team: TeamRow | null;
  leaders: LeaderOption[];
  busy: boolean;
  onSubmit: (v: TeamInput) => void;
  onCancel: () => void;
  onToggle?: () => void;
}) {
  const [v, setV] = useState<TeamInput>({ name: team?.name ?? "", colour: team?.colour ?? "#2563eb", leaderId: team?.leaderId ?? null });
  return (
    <form
      className="flex flex-col gap-3 px-4 pb-2 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <Field label="Name">
        <input className={inputCls} required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Graphic" />
      </Field>
      <Field label="Colour">
        <ColourInput value={v.colour ?? "#2563eb"} onChange={(colour) => setV({ ...v, colour })} />
      </Field>
      <Field label="Leader" hint="Pick from active Team Leaders (add them under Add Team Leader first)">
        <select className={inputCls} value={v.leaderId ?? ""} onChange={(e) => setV({ ...v, leaderId: e.target.value || null })}>
          <option value="">— none —</option>
          {leaders.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
      <FormFooter
        busy={busy}
        onCancel={onCancel}
        extra={
          onToggle ? (
            <button type="button" className={btnSecondary} disabled={busy} onClick={onToggle}>
              {team?.active ? "Deactivate" : "Activate"}
            </button>
          ) : null
        }
      />
    </form>
  );
}
