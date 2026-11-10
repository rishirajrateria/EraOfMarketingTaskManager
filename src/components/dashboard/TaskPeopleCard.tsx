"use client";
import { FileText, FolderOpen } from "lucide-react";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { taskPeople } from "@/components/dashboard/format";

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="shrink-0 text-muted">{k}</span>
      <span className="text-right font-medium text-ink">{v}</span>
    </div>
  );
}

/**
 * "Who" block of the (i) sheet (ADR 0015): the card no longer shows people, so the team, its Team Leader, the assigned
 * person(s) and Admin's executive preference are listed here. Meetings list their people instead.
 */
export function TaskPeopleCard({ t, data }: { t: TaskRow; data: DashboardData }) {
  const p = taskPeople(t, data.people);
  const none = "—";
  return (
    <section className="glass-card px-3 py-2" aria-label="Assigned to">
      <h3 className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-[.07em] text-muted">{t.type === "MEETING" ? "People" : "Assigned to"}</h3>
      {t.type === "MEETING" ? (
        <Line k="Invited" v={p.assigned.join(", ") || none} />
      ) : (
        <>
          <Line k="Team" v={p.teams.join(", ") || none} />
          <Line k="Team Leader" v={p.leaders.join(", ") || "no Team Leader yet"} />
          <Line k="Assigned" v={p.assigned.join(", ") || none} />
          <Line k="Admin's preference" v={p.preferred.join(", ") || "none"} />
        </>
      )}
    </section>
  );
}

/** Gemini notes / transcripts filed into the task's Drive "Meeting notes" folder by the meeting-notes job. */
export function MeetingNotesCard({ t }: { t: TaskRow }) {
  if (!t.meetingNotesUrl && !t.meetingNotes.length) return null;
  return (
    <section aria-label="Meeting notes">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Meeting notes</h3>
        {t.meetingNotesUrl ? (
          <a href={t.meetingNotesUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs font-medium text-brand-blue">
            <FolderOpen size={14} aria-hidden /> Open folder
          </a>
        ) : null}
      </div>
      {t.meetingNotes.length ? (
        <ul className="space-y-1">
          {t.meetingNotes.map((n) => (
            <li key={n.id}>
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-brand-blue underline">
                <FileText size={14} className="shrink-0" aria-hidden />
                {n.kind === "SMART_NOTES" ? "Gemini notes" : "Transcript"} · {new Date(n.createdAt).toLocaleDateString(undefined, { day: "2-digit", month: "short" })}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">Gemini notes appear here after a call on the task&apos;s Meet link.</p>
      )}
    </section>
  );
}
