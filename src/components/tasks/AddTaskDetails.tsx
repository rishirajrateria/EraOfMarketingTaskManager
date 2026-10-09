"use client";
import { useEffect, useRef } from "react";
import { clsx } from "@/lib/clsx";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, inputCls } from "@/components/ui/Field";
import type { DashboardData } from "@/server/tasks/types";
import { RecurrencePicker } from "@/components/tasks/RecurrencePicker";
import { SlotPreview } from "@/components/tasks/SlotPreview";
import { hoursToMinutes, toggleId, type AddTaskErrors, type AddTaskForm, type Person } from "@/components/tasks/add-task-helpers";

export type FieldErrors = AddTaskErrors;
export type DetailsFocus = "schedule" | null;

function Chip({ active, onClick, children, colour }: { active: boolean; onClick: () => void; children: React.ReactNode; colour?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "touch-target inline-flex items-center gap-1 rounded-full px-3 text-xs font-medium transition",
        active ? "bg-gradient-to-b from-[#2f74e6] to-[#1e63d6] text-white shadow-[0_4px_12px_rgba(30,99,214,.3),inset_0_1px_0_rgba(255,255,255,.35)]" : "glass-chip text-gray-800 hover:bg-white/80",
      )}
    >
      {colour ? <span className="h-2 w-2 rounded-full" style={{ background: colour }} aria-hidden /> : null}
      {children}
    </button>
  );
}

const Err = ({ text }: { text?: string }) => (text ? <span className="mt-1 block text-[11px] text-red-600">{text}</span> : null);

/** Assignee / attendee chips (shared by the details sheet and the quick assignee chooser). */
function AssigneeChips({ form, patch, data, assignees, error }: { form: AddTaskForm; patch: (p: Partial<AddTaskForm>) => void; data: DashboardData; assignees: Person[]; error?: string }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {assignees.map((a) => (
          <Chip key={a.id} active={form.assigneeIds.includes(a.id)} onClick={() => patch({ assigneeIds: toggleId(form.assigneeIds, a.id) })}>
            {a.id === data.me.id ? `${a.name.split(" ")[0]} (me)` : a.name}
          </Chip>
        ))}
      </div>
      <Err text={error} />
    </div>
  );
}

/** Quick assignee chooser opened from the people glyph in the dark body. */
export function AssigneeSheet({ open, onClose, ...rest }: { open: boolean; onClose: () => void; form: AddTaskForm; patch: (p: Partial<AddTaskForm>) => void; data: DashboardData; assignees: Person[] }) {
  const meeting = rest.form.type === "MEETING";
  return (
    <Sheet open={open} onClose={onClose} title={meeting ? "Attendees" : "Assignees"}>
      <div className="space-y-4 px-4 py-4">
        <AssigneeChips {...rest} />
        <button type="button" onClick={onClose} className={clsx(btnPrimary, "w-full")}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

/** Recurrence popover opened from the loop icon. */
export function LoopSheet({ open, onClose, value, onChange }: { open: boolean; onClose: () => void; value: AddTaskForm["recurrence"]; onChange: (r: AddTaskForm["recurrence"]) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Loop">
      <div className="space-y-4 px-4 py-4">
        <RecurrencePicker value={value} onChange={onChange} />
        <button type="button" onClick={onClose} className={clsx(btnPrimary, "w-full")}>
          Done
        </button>
      </div>
    </Sheet>
  );
}

type DetailsProps = {
  open: boolean;
  onClose: () => void;
  focus: DetailsFocus;
  form: AddTaskForm;
  patch: (p: Partial<AddTaskForm>) => void;
  data: DashboardData;
  assignees: Person[];
  errors: FieldErrors;
  manualTime: boolean;
  setManualTime: (v: boolean) => void;
  /** Who the slot is proposed for (the effective assignees, ADR 0008). */
  slotAssigneeIds: string[];
  disabled: boolean;
};

/**
 * DETAILS SHEET (light): client, meeting attendees, hours, schedule, priority, loop. Team, work type and executives
 * are picked in the green rows (ADR 0008).
 */
export function AddTaskDetails(p: DetailsProps) {
  const { open, onClose, focus, form, patch, data, assignees, errors, manualTime, setManualTime, slotAssigneeIds, disabled } = p;
  const schedule = useRef<HTMLDivElement>(null);
  const meeting = form.type === "MEETING";
  const showTimeInputs = manualTime || !!form.scheduledStart;

  useEffect(() => {
    if (open && focus === "schedule") schedule.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [open, focus]);

  return (
    <Sheet open={open} onClose={onClose} title={meeting ? "Meeting details" : "Task details"}>
      <div className="space-y-4 px-4 py-4 text-gray-900">
        <Field label="Client" hint={data.clients.length ? undefined : "No clients yet — add clients in Admin → Add Client"}>
          <select value={form.clientId} onChange={(e) => patch({ clientId: e.target.value })} className={clsx(inputCls, errors.clientId && "border-red-500")} disabled={disabled}>
            <option value="">Select a client…</option>
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Err text={errors.clientId} />
        </Field>

        {meeting ? (
          <div>
            <span className="mb-1 block text-xs font-medium text-gray-600">Attendees</span>
            <AssigneeChips form={form} patch={patch} data={data} assignees={assignees} error={errors.assigneeIds} />
          </div>
        ) : null}

        <Field label="Allocated time (hours)">
          <input
            type="number"
            inputMode="decimal"
            min={0.25}
            step={0.5}
            value={form.allocatedHours}
            onChange={(e) => patch({ allocatedHours: e.target.value })}
            className={clsx(inputCls, errors.allocatedHours && "border-red-500")}
            disabled={disabled}
          />
          <Err text={errors.allocatedHours} />
        </Field>

        <div ref={schedule} className="scroll-mt-14">
          <span className="mb-1 block text-xs font-medium text-gray-600">Scheduled date &amp; time</span>
          {showTimeInputs ? (
            <div className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Start">
                  <input type="datetime-local" value={form.scheduledStart} onChange={(e) => patch({ scheduledStart: e.target.value })} className={inputCls} disabled={disabled} />
                </Field>
                <Field label="Stop (optional)">
                  <input type="datetime-local" value={form.scheduledEnd} min={form.scheduledStart || undefined} onChange={(e) => patch({ scheduledEnd: e.target.value })} className={inputCls} disabled={disabled} />
                </Field>
              </div>
              <button
                type="button"
                onClick={() => {
                  setManualTime(false);
                  patch({ scheduledStart: "", scheduledEnd: "", acceptProposedSlot: true });
                }}
                className="touch-target text-xs font-medium text-brand-blue"
              >
                ← Use next available slot instead
              </button>
            </div>
          ) : (
            <SlotPreview
              assigneeIds={slotAssigneeIds}
              allocatedMinutes={hoursToMinutes(form.allocatedHours)}
              tz={data.tz}
              accepted={form.acceptProposedSlot}
              onAccept={() => patch({ acceptProposedSlot: true })}
              onPickManually={() => setManualTime(true)}
            />
          )}
          {meeting ? <p className="mt-1 text-[11px] text-gray-400">Meetings need a time — leave it empty to auto-pick the next slot when every attendee is free.</p> : null}
        </div>

        <label className="flex items-center justify-between gap-2 text-xs text-gray-600">
          Priority
          <select value={form.priority} onChange={(e) => patch({ priority: e.target.value as AddTaskForm["priority"] })} className={clsx(inputCls, "w-auto")}>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </label>

        {!meeting ? <RecurrencePicker value={form.recurrence} onChange={(recurrence) => patch({ recurrence })} /> : null}

        <button type="button" onClick={onClose} className={clsx(btnPrimary, "w-full")}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
