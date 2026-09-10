"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AttendanceStatus } from "@prisma/client";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { markAttendance } from "@/server/attendance/actions";
import { STATUS_ORDER, STATUS_STYLE } from "@/components/attendance/status";
import type { GridCell } from "@/server/attendance/queries";

export type MarkTarget = { userId: string; userName: string; date: string; cell: GridCell | undefined };

/** Convert "10:05am" (grid display) back to "HH:mm" for the form; blank if unparsable. */
function toHHMM(display: string | null): string {
  if (!display) return "";
  const m = /^(\d{1,2}):(\d{2})(am|pm)$/i.exec(display);
  if (!m) return "";
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function MarkAttendanceSheet({ target, onClose }: { target: MarkTarget | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<AttendanceStatus>(target?.cell?.status ?? "PRESENT");
  const [checkIn, setCheckIn] = useState(toHHMM(target?.cell?.checkIn ?? null));
  const [checkOut, setCheckOut] = useState(toHHMM(target?.cell?.checkOut ?? null));
  const [note, setNote] = useState(target?.cell?.note ?? "");

  if (!target) return null;
  const submit = () =>
    start(async () => {
      const r = await markAttendance({ userId: target.userId, date: target.date, status, checkIn: checkIn || null, checkOut: checkOut || null, note: note || null });
      if (!r.ok) return toast(r.error, "err");
      toast("Attendance saved");
      onClose();
      router.refresh();
    });

  return (
    <Sheet open onClose={onClose} title={`${target.userName} · ${target.date}`}>
      <div className="space-y-3 px-4 py-4">
        <div className="flex flex-wrap gap-2">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[s].cls} ${status === s ? "ring-2 ring-gray-900" : "opacity-70"}`}
            >
              {STATUS_STYLE[s].label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Check in">
            <input type="time" className={inputCls} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </Field>
          <Field label="Check out">
            <input type="time" className={inputCls} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </Field>
        </div>
        <Field label="Note">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button className={btnSecondary} onClick={onClose} disabled={pending}>
            Cancel
          </button>
          <button className={btnPrimary} onClick={submit} disabled={pending}>
            Save
          </button>
        </div>
      </div>
    </Sheet>
  );
}
