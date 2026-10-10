"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, inputCls, btnDanger, btnSecondary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { BarChip, BottomZone } from "@/components/ui/BottomZone";
import { EditPill, EmptyState, FormFooter, ListRow, PillPicker, Screen, ScreenHeader, SectionLabel, useAdminAction } from "@/components/admin/AdminUi";
import { PeekZone } from "@/components/shell/PeekBar";
import { useAddForm } from "@/components/shell/useAddForm";
import { LIST_FLOWS } from "@/components/shell/list-flow";
import { createWorkType, removeWorkType, setWorkTypeActive, updateWorkType } from "@/server/admin/actions";
import type { TeamOption, WorkTypeRow } from "@/server/admin/queries";

type Values = { name: string; teamIds: string[] };

/**
 * /admin/work-types — "Add Work" (SPEC §11.8, ADR 0008). Each work type belongs to one or more teams; in Add task,
 * picking a team shows only its work types. Listed grouped by team (a work type in several teams appears under each).
 * `?add=1` opens the add form; from the "+" speed dial (`&from=add`, or `?add=min` from its eye) it is the list flow
 * (useAddForm, ADR 0016 addendum).
 */
export function WorkTypesManager({ workTypes, teams, openAdd = false }: { workTypes: WorkTypeRow[]; teams: TeamOption[]; openAdd?: boolean }) {
  const { busy, run } = useAdminAction();
  const add = useAddForm(openAdd);
  const [formKey, setFormKey] = useState(0); // a blank add form after each save
  const [editing, setEditing] = useState<WorkTypeRow | null>(null);
  const closeEdit = () => setEditing(null);

  const create = async (values: Values) => {
    if (!(await run(createWorkType({ ...values, colour: "#f59e0b" }), "Work type added"))) return;
    setFormKey((k) => k + 1);
    add.saved();
  };
  const save = async (values: Values) => {
    if (editing && (await run(updateWorkType({ ...values, colour: editing.colour, id: editing.id }), "Saved"))) closeEdit();
  };
  const remove = async (w: WorkTypeRow) => {
    if (await run(removeWorkType(w.id), "Work type removed")) closeEdit();
  };
  const restore = async (w: WorkTypeRow) => {
    if (await run(setWorkTypeActive(w.id, true), "Work type restored")) closeEdit();
  };

  const active = workTypes.filter((w) => w.active);
  const removed = workTypes.filter((w) => !w.active);
  const orphan = active.filter((w) => !w.teamIds.length);
  const edit = (w: WorkTypeRow) => setEditing(w);
  const row = (w: WorkTypeRow, key: string) => (
    <ListRow
      key={key}
      title={w.name}
      subtitle={`${w.teams.map((t) => t.name).join(", ") || "no team yet"} · ${w._count.tasks} task${w._count.tasks === 1 ? "" : "s"}`}
      trailing={<EditPill />}
      inactive={!w.active}
      onClick={() => edit(w)}
    />
  );

  const zone = add.inFlow ? (
    <PeekZone label={LIST_FLOWS.WORK_TYPE.peek} onExpand={add.show} />
  ) : (
    <BottomZone
      menu
      right={
        <BarChip label="Add work type" onClick={add.show}>
          + Add work
        </BarChip>
      }
    />
  );

  return (
    <Screen header={<ScreenHeader title="Add Work" subtitle={`${active.length} work types · picking a team in Add task shows only its work types`} />} zone={zone} className="pb-3">
      <p className="px-4 pt-3 text-xs text-gray-500">Each work type belongs to one or more teams. In Add task, picking a team shows only its work types.</p>
      {workTypes.length === 0 ? <EmptyState>No work types yet. Tap ＋ Add work to add one.</EmptyState> : null}
      {teams.map((t) => {
        const ws = active.filter((w) => w.teamIds.includes(t.id));
        return (
          <section key={t.id}>
            <SectionLabel>
              {t.name} · {ws.length}
            </SectionLabel>
            {ws.length ? ws.map((w) => row(w, `${t.id}:${w.id}`)) : <p className="px-4 pb-2 text-xs text-gray-400">No work types yet</p>}
          </section>
        );
      })}
      {orphan.length ? (
        <section>
          <SectionLabel>Not in any team · {orphan.length}</SectionLabel>
          {orphan.map((w) => row(w, `none:${w.id}`))}
        </section>
      ) : null}
      {removed.length ? (
        <section>
          <SectionLabel>Removed · {removed.length}</SectionLabel>
          {removed.map((w) => row(w, `off:${w.id}`))}
        </section>
      ) : null}
      <Sheet open={add.open || add.minimised} minimised={add.minimised} onClose={add.dismiss} onCornerClose={add.cancel} title="Add work type">
        <WorkTypeForm key={`new-${formKey}`} workType={null} teams={teams} busy={busy} onSubmit={create} />
      </Sheet>
      <Sheet open={!!editing} onClose={closeEdit} title="Edit work type">
        {editing ? (
          <WorkTypeForm
            key={editing.id}
            workType={editing}
            teams={teams}
            busy={busy}
            onSubmit={save}
            onRemove={() => (editing.active ? remove(editing) : restore(editing))}
          />
        ) : null}
      </Sheet>
    </Screen>
  );
}

function WorkTypeForm({
  workType,
  teams,
  busy,
  onSubmit,
  onRemove,
}: {
  workType: WorkTypeRow | null;
  teams: TeamOption[];
  busy: boolean;
  onSubmit: (v: Values) => void;
  onRemove?: () => void;
}) {
  const toast = useToast();
  const [v, setV] = useState<Values>({ name: workType?.name ?? "", teamIds: workType?.teamIds ?? [] });
  return (
    <form
      className="flex flex-col gap-3 px-4 pb-2 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.name.trim()) return toast("Name is required", "err");
        if (!v.teamIds.length) return toast("Pick at least one team", "err");
        onSubmit(v);
      }}
    >
      <Field label="Name">
        <input className={inputCls} required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Video editing" />
      </Field>
      <Field label="Teams" hint="Pick one or more teams that do this work">
        <PillPicker options={teams} value={v.teamIds} onChange={(teamIds) => setV({ ...v, teamIds })} empty="No teams yet · Menu → Add Team" />
      </Field>
      <FormFooter
        busy={busy}
        extra={
          onRemove ? (
            <button type="button" className={workType?.active ? btnDanger : btnSecondary} disabled={busy} onClick={onRemove}>
              {workType?.active ? "Remove" : "Restore"}
            </button>
          ) : null
        }
      />
    </form>
  );
}
