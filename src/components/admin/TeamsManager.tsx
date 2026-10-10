"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, inputCls, btnSecondary } from "@/components/ui/Field";
import { BarChip, BottomZone } from "@/components/ui/BottomZone";
import { ColourDot, ColourInput, EmptyState, FormFooter, ListRow, Screen, ScreenHeader, StatusPill, useAdminAction } from "@/components/admin/AdminUi";
import { PeekZone } from "@/components/shell/PeekBar";
import { useAddForm } from "@/components/shell/useAddForm";
import { LIST_FLOWS } from "@/components/shell/list-flow";
import { createTeam, setTeamActive, updateTeam } from "@/server/admin/actions";
import type { LeaderOption, TeamRow } from "@/server/admin/queries";
import type { TeamInput } from "@/server/admin/schemas";

/**
 * /admin/teams — "Add Team" (SPEC §11.8; called "Add Designation" in the original spec). `?add=1` opens the add form;
 * from the "+" speed dial (`&from=add`, or `?add=min` from its eye) it is the list flow (useAddForm, ADR 0016 addendum).
 */
export function TeamsManager({ teams, leaders, openAdd = false }: { teams: TeamRow[]; leaders: LeaderOption[]; openAdd?: boolean }) {
  const { busy, run } = useAdminAction();
  const add = useAddForm(openAdd);
  const [formKey, setFormKey] = useState(0); // a blank add form after each save
  const [editing, setEditing] = useState<TeamRow | null>(null);
  const closeEdit = () => setEditing(null);

  const create = async (values: TeamInput) => {
    if (!(await run(createTeam(values), "Team added"))) return;
    setFormKey((k) => k + 1);
    add.saved();
  };
  const save = async (values: TeamInput) => {
    if (editing && (await run(updateTeam({ ...values, id: editing.id }), "Saved"))) closeEdit();
  };
  const toggle = async (t: TeamRow) => {
    if (await run(setTeamActive(t.id, !t.active), t.active ? "Deactivated" : "Activated")) closeEdit();
  };

  const zone = add.inFlow ? (
    <PeekZone label={LIST_FLOWS.TEAM.peek} onExpand={add.show} />
  ) : (
    <BottomZone
      menu
      right={
        <BarChip label="Add designation" onClick={add.show}>
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
          onClick={() => setEditing(t)}
        />
      ))}
      <Sheet open={add.open || add.minimised} minimised={add.minimised} onClose={add.dismiss} onCornerClose={add.cancel} title="Add designation">
        <TeamForm key={`new-${formKey}`} team={null} leaders={leaders} busy={busy} onSubmit={create} />
      </Sheet>
      <Sheet open={!!editing} onClose={closeEdit} title="Edit designation">
        {editing ? <TeamForm key={editing.id} team={editing} leaders={leaders} busy={busy} onSubmit={save} onToggle={() => toggle(editing)} /> : null}
      </Sheet>
    </Screen>
  );
}

function TeamForm({
  team,
  leaders,
  busy,
  onSubmit,
  onToggle,
}: {
  team: TeamRow | null;
  leaders: LeaderOption[];
  busy: boolean;
  onSubmit: (v: TeamInput) => void;
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
