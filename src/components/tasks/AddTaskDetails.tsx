"use client";
import { useEffect, useState } from "react";
import { addDays } from "date-fns";
import { clsx } from "@/lib/clsx";
import { dateKey } from "@/lib/time";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { SegButton } from "@/components/ui/Controls";
import type { DashboardData } from "@/server/tasks/types";
import { toggleId, type AddTaskForm, type Person } from "@/components/tasks/add-task-helpers";

/**
 * "When should it start?" (prototype `scheduleSheet`), opened from the calendar icon in the bottom bar: date + start
 * time, or "Next free slot" (= upnext). The add-task body itself has no date / time inputs (ADR 0010).
 */
export function ScheduleSheet({ open, onClose, value, tz, onSet, onError }: { open: boolean; onClose: () => void; value: string; tz: string; onSet: (datetimeLocal: string) => void; onError: (m: string) => void }) {
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  useEffect(() => {
    if (!open) return;
    setDate(value ? value.slice(0, 10) : dateKey(addDays(new Date(), 1), tz));
    setTime(value ? value.slice(11, 16) : "10:00");
  }, [open, value, tz]);
  return (
    <Sheet open={open} onClose={onClose} title="When should it start?">
      <div className="px-4 pb-5 pt-1">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Date">
            <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start time">
            <input type="time" className={inputCls} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <p className="mb-2 mt-3 text-xs text-muted">Or close this and use upnext / Tom / today in the bar.</p>
        <div className="mt-3 flex gap-2.5">
          <button
            type="button"
            className={clsx(btnSecondary, "flex-1")}
            onClick={() => {
              onSet("");
              onClose();
            }}
          >
            Next free slot
          </button>
          <button
            type="button"
            className={clsx(btnPrimary, "flex-1")}
            onClick={() => {
              if (!date) return onError("Pick a date");
              onSet(`${date}T${time || "10:00"}`);
              onClose();
            }}
          >
            Set
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Meeting attendees, opened from the people glyph next to Save. */
export function AssigneeSheet({ open, onClose, form, patch, data, assignees }: { open: boolean; onClose: () => void; form: AddTaskForm; patch: (p: Partial<AddTaskForm>) => void; data: DashboardData; assignees: Person[] }) {
  return (
    <Sheet open={open} onClose={onClose} title={form.type === "MEETING" ? "Attendees" : "Assignees"}>
      <div className="space-y-4 px-4 pb-5 pt-1">
        <div className="flex flex-wrap gap-2">
          {assignees.map((a) => (
            <SegButton key={a.id} on={form.assigneeIds.includes(a.id)} onClick={() => patch({ assigneeIds: toggleId(form.assigneeIds, a.id) })}>
              {a.id === data.me.id ? `${a.name.split(" ")[0]} (me)` : a.name}
            </SegButton>
          ))}
        </div>
        <button type="button" onClick={onClose} className={clsx(btnPrimary, "w-full")}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
