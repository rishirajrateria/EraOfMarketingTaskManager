"use client";
import { CalendarX, FileX, FolderX, MessageSquareX, VideoOff } from "lucide-react";
import type { TaskRow } from "@/server/tasks/types";
import { Sheet } from "@/components/ui/Sheet";
import { btnDanger, btnSecondary } from "@/components/ui/Field";

/** What a delete removes, in the order shown (ADR 0015). Pure — unit-tested. */
export function deleteItems(t: Pick<TaskRow, "type" | "calendarEventId" | "meetLink" | "driveFolderUrl" | "chatSpaceUrl">): { key: string; label: string; detail: string }[] {
  const items = [
    { key: "calendar", label: "Google Calendar event", detail: "removed from everyone's calendar", on: !!t.calendarEventId },
    { key: "meet", label: "Google Meet link", detail: "call ended and the link locked — Google can't delete a link", on: !!t.meetLink },
    { key: "drive", label: "Drive folder and all its files", detail: "moved to the Drive trash, incl. meeting notes", on: !!t.driveFolderUrl },
    { key: "chat", label: "Google Chat space", detail: "deleted with its messages", on: !!t.chatSpaceUrl },
  ];
  return [
    ...items.filter((i) => i.on).map(({ key, label, detail }) => ({ key, label, detail })),
    { key: "data", label: "Task details", detail: "description, time sessions, requests, voice notes and attachments" },
  ];
}

const ICONS: Record<string, React.ReactNode> = {
  calendar: <CalendarX size={18} />,
  meet: <VideoOff size={18} />,
  drive: <FolderX size={18} />,
  chat: <MessageSquareX size={18} />,
  data: <FileX size={18} />,
};

/** Delete confirmation (ADR 0015): everything goes — a clear list of what will be removed and one confirm. */
export function DeleteTaskSheet({ task, open, busy, onConfirm, onClose }: { task: TaskRow | null; open: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <Sheet open={open && !!task} onClose={onClose} title="Delete task">
      {task ? (
        <div className="space-y-3 px-5 pb-6 pt-2">
          <p className="text-sm text-ink">
            Delete <span className="font-semibold">{task.title}</span>? This removes:
          </p>
          <ul className="glass-card divide-y divide-[var(--line)] px-3" aria-label="What will be removed">
            {deleteItems(task).map((i) => (
              <li key={i.key} className="flex items-start gap-3 py-2.5">
                <span className="mt-0.5 shrink-0 text-[#dc2626] dark:text-[#fca5a5]" aria-hidden>
                  {ICONS[i.key]}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold leading-tight text-ink">{i.label}</span>
                  <span className="block text-[11.5px] leading-snug text-muted">{i.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] text-muted">This can&apos;t be undone from the app. Drive keeps trashed files for 30 days.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className={btnSecondary} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnDanger} disabled={busy} onClick={onConfirm}>
              Delete everything
            </button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
