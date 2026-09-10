"use client";
import { useEffect, useState } from "react";
import type { TaskRow } from "@/server/tasks/types";
import { Sheet } from "@/components/ui/Sheet";
import { btnDanger, btnSecondary } from "@/components/ui/Field";

export type DeleteOptions = { deleteChat: boolean; deleteDrive: boolean; deleteData: boolean };
const ALL: DeleteOptions = { deleteChat: true, deleteDrive: true, deleteData: true };

/** Delete confirmation (SPEC §12): three pre-checked, individually deselectable checkboxes. Calendar/Meet always removed. */
export function DeleteTaskSheet({
  task,
  open,
  busy,
  onConfirm,
  onClose,
}: {
  task: TaskRow | null;
  open: boolean;
  busy?: boolean;
  onConfirm: (opts: DeleteOptions) => void;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState<DeleteOptions>(ALL);
  useEffect(() => {
    if (open) setOpts(ALL);
  }, [open]);
  const row = (key: keyof DeleteOptions, label: string) => (
    <label className="touch-target flex items-center gap-3 px-1 text-sm">
      <input type="checkbox" checked={opts[key]} onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })} className="h-5 w-5 accent-red-600" />
      <span>{label}</span>
    </label>
  );
  return (
    <Sheet open={open && !!task} onClose={onClose} title="Delete task">
      <div className="space-y-2 px-4 pb-6 pt-3">
        <p className="text-sm text-gray-700">
          Delete <span className="font-semibold">{task?.title}</span>?
        </p>
        {row("deleteChat", "Delete Google Chat space")}
        {row("deleteDrive", "Delete Drive folder and files")}
        {row("deleteData", "Delete task data (history, sessions, requests)")}
        <p className="text-[11px] text-gray-500">The Calendar event and Meet link are always removed. Unchecked items are kept and the task is marked deleted.</p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnDanger} disabled={busy} onClick={() => onConfirm(opts)}>
            Delete
          </button>
        </div>
      </div>
    </Sheet>
  );
}
