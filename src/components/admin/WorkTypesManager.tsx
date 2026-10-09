"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, inputCls, btnSecondary } from "@/components/ui/Field";
import { BarChip, BottomZone } from "@/components/ui/BottomZone";
import { ColourInput, EmptyState, FormFooter, ListRow, Screen, ScreenHeader, StatusPill, useAdminAction } from "@/components/admin/AdminUi";
import { createWorkType, setWorkTypeActive, updateWorkType } from "@/server/admin/actions";
import type { WorkTypeRow } from "@/server/admin/queries";
import type { WorkTypeInput } from "@/server/admin/schemas";

/** /admin/work-types — "Add Work" (SPEC §11.8): tag pills used in Add-task and the Row-2 filter. */
export function WorkTypesManager({ workTypes }: { workTypes: WorkTypeRow[] }) {
  const { busy, run } = useAdminAction();
  const [editing, setEditing] = useState<WorkTypeRow | null>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    setEditing(null);
  };

  const submit = async (values: WorkTypeInput) => {
    const res = editing ? await run(updateWorkType({ ...values, id: editing.id }), "Saved") : await run(createWorkType(values), "Work type added");
    if (res) close();
  };
  const toggle = async (w: WorkTypeRow) => {
    const res = await run(setWorkTypeActive(w.id, !w.active), w.active ? "Deactivated" : "Activated");
    if (res) close();
  };

  const zone = (
    <BottomZone
      menu
      right={
        <BarChip label="Add work type" onClick={() => setOpen(true)}>
          + Add
        </BarChip>
      }
    />
  );

  return (
    <Screen header={<ScreenHeader title="Add Work" subtitle={`${workTypes.filter((w) => w.active).length} active · tags such as Pharma bag, Robam`} />} zone={zone} className="pb-3">
      {workTypes.length === 0 ? <EmptyState>No work types yet. Tap ＋ Add to add one.</EmptyState> : null}
      {workTypes.map((w) => (
        <ListRow
          key={w.id}
          title={w.name}
          subtitle={`${w._count.tasks} task${w._count.tasks === 1 ? "" : "s"}`}
          leading={
            <span className="rounded-full px-3 py-1 text-xs font-medium text-white" style={{ background: w.colour }}>
              {w.name}
            </span>
          }
          trailing={<StatusPill active={w.active} />}
          inactive={!w.active}
          onClick={() => {
            setEditing(w);
            setOpen(true);
          }}
        />
      ))}
      <Sheet open={open} onClose={close} title={editing ? "Edit work type" : "Add work type"}>
        {open ? <WorkTypeForm key={editing?.id ?? "new"} workType={editing} busy={busy} onSubmit={submit} onCancel={close} onToggle={editing ? () => toggle(editing) : undefined} /> : null}
      </Sheet>
    </Screen>
  );
}

function WorkTypeForm({
  workType,
  busy,
  onSubmit,
  onCancel,
  onToggle,
}: {
  workType: WorkTypeRow | null;
  busy: boolean;
  onSubmit: (v: WorkTypeInput) => void;
  onCancel: () => void;
  onToggle?: () => void;
}) {
  const [v, setV] = useState<WorkTypeInput>({ name: workType?.name ?? "", colour: workType?.colour ?? "#f59e0b" });
  return (
    <form
      className="flex flex-col gap-3 px-4 pb-2 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <Field label="Name">
        <input className={inputCls} required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="e.g. Pharma bag" />
      </Field>
      <Field label="Colour">
        <ColourInput value={v.colour ?? "#f59e0b"} onChange={(colour) => setV({ ...v, colour })} />
      </Field>
      <div className="text-xs text-gray-500">
        Preview:{" "}
        <span className="rounded-full px-3 py-1 text-xs font-medium text-white" style={{ background: v.colour ?? "#f59e0b" }}>
          {v.name || "Tag"}
        </span>
      </div>
      <FormFooter
        busy={busy}
        onCancel={onCancel}
        extra={
          onToggle ? (
            <button type="button" className={btnSecondary} disabled={busy} onClick={onToggle}>
              {workType?.active ? "Deactivate" : "Activate"}
            </button>
          ) : null
        }
      />
    </form>
  );
}
