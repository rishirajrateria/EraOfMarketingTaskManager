"use client";
import { useFromAdd } from "@/components/dashboard/useFromAdd";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, inputCls, btnSecondary } from "@/components/ui/Field";
import { BarChip, BottomZone } from "@/components/ui/BottomZone";
import { ColourDot, ColourInput, EmptyState, FormFooter, ListRow, Screen, ScreenHeader, StatusPill, useAdminAction } from "@/components/admin/AdminUi";
import { createTeam, setTeamActive, updateTeam } from "@/server/admin/actions";
import type { LeaderOption, TeamRow } from "@/server/admin/queries";
import type { TeamInput } from "@/server/admin/schemas";

/** /admin/teams — "Add Team" (SPEC §11.8; called "Add Designation" in the original spec). */
export function TeamsManager({ teams, leaders, openAdd = false }: { teams: TeamRow[]; leaders: LeaderOption[]; openAdd?: boolean }) {
  const { busy, run } = useAdminAction();
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const [open, setOpen] = useState(openAdd); // `?add=1` opens the add form on load
  const back = useFromAdd(); // opened from the dashboard "+": closing or saving returns there
  const close = () => {
    setOpen(false);
    setEditing(null);
    back.done();
  };

  const submit = async (values: TeamInput) => {
    const res = editing ? await run(updateTeam({ ...values, id: editing.id }), "Saved") : await run(createTeam(values), "Team added");
    if (res) close();
  };
  const toggle = async (t: TeamRow) => {
    const res = await run(setTeamActive(t.id, !t.active), t.active ? "Deactivated" : "Activated");
    if (res) close();
  };

  const zone = (
    <BottomZone
      menu
      right={
        <BarChip label="Add designation" onClick={() => setOpen(true)}>
          + Add
        </BarChip>
      }
    />
  );

  return (
    <Screen header={<ScreenHeader title="Add Team" subtitle={`${teams.filter((t) => t.active).length} active · Graphic, Finance, Website, Video, Write…`} />} zone={zone} className="pb-3">
      {teams.length === 0 ? <EmptyState>No designations yet. Tap ＋ Add to add one.</EmptyState> : null}
      {teams.map((t) => (
        <ListRow
          key={t.id}
          title={t.name}
          subtitle={
            <>
              {`${t.leader ? `Lead: ${t.leader.name}` : "No leader"} · ${t._count.members} member${t._count.members === 1 ? "" : "s"}`}
              <span className="block truncate">work: {t.workTypes.map((w) => w.name).join(", ") || "none"}</span>
            </>
          }
          leading={<ColourDot colour={t.colour} size={14} />}
          trailing={<StatusPill active={t.active} />}
          inactive={!t.active}
          onClick={() => {
            setEditing(t);
            setOpen(true);
          }}
        />
      ))}
      <Sheet open={open} onClose={close} title={editing ? "Edit designation" : "Add designation"} hideClose>
        {open ? (
          <TeamForm key={editing?.id ?? "new"} team={editing} leaders={leaders} busy={busy} onSubmit={submit} onCancel={close} onToggle={editing ? () => toggle(editing) : undefined} />
        ) : null}
      </Sheet>
    </Screen>
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
      <Field label="Leader" hint="One team leader per team · the chosen leader moves into this team">
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
