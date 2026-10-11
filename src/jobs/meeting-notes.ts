/**
 * Every 30 minutes (ADR 0015): files the Gemini "Take notes for me" Docs (and transcripts) of each task's Meet into the
 * task's Drive folder → "Meeting notes". Idempotent: a Doc is recorded in `TaskMeetingNote` once filed.
 *
 * Only tasks whose meeting could have happened are looked at: a configured Meet space, scheduled start in the past,
 * and scheduled end within the last 30 days (Meet keeps conference records for 30 days).
 */
import { prisma } from "@/lib/db";
import { publishTaskChanged } from "@/lib/notify";
import * as Meet from "@/google/meet";
import * as Drive from "@/google/drive";
import { ensureTaskFolder } from "@/google/task-folder";

const LOOKBACK_DAYS = 30;
const MAX_TASKS = 200;

export type MeetingNotesResult = { tasks: number; filed: number; shortcuts: number; warnings: string[] };

/** Docs not filed yet (pure). */
export function unfiledArtifacts(artifacts: Meet.MeetArtifact[], filedDocIds: Iterable<string>): Meet.MeetArtifact[] {
  const seen = new Set(filedDocIds);
  const out: Meet.MeetArtifact[] = [];
  for (const a of artifacts) {
    if (seen.has(a.docId)) continue;
    seen.add(a.docId);
    out.push(a);
  }
  return out;
}

export async function run(now = new Date()): Promise<MeetingNotesResult> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60_000);
  const tasks = await prisma.task.findMany({
    where: { deletedAt: null, meetSpaceName: { not: null }, scheduledStart: { lte: now }, scheduledEnd: { gte: since } },
    select: { id: true, meetSpaceName: true, scheduledEnd: true, meetingNotes: { select: { docId: true } } },
    orderBy: { scheduledEnd: "desc" },
    take: MAX_TASKS,
  });
  const out: MeetingNotesResult = { tasks: tasks.length, filed: 0, shortcuts: 0, warnings: [] };
  for (const t of tasks) {
    try {
      const artifacts = await Meet.listMeetArtifacts(t.meetSpaceName!, { mockMeetingEnd: t.scheduledEnd, now });
      const todo = unfiledArtifacts(artifacts, t.meetingNotes.map((n) => n.docId));
      if (!todo.length) continue;
      const folder = await ensureTaskFolder(t.id);
      for (const a of todo) {
        const filedAs = await Drive.moveOrShortcut(a.docId, folder.notesFolderId);
        await prisma.taskMeetingNote.upsert({
          where: { taskId_docId: { taskId: t.id, docId: a.docId } },
          update: {},
          create: { taskId: t.id, kind: a.kind, conferenceRecord: a.conferenceRecord, docId: a.docId, docUrl: a.docUrl, filedAs },
        });
        out.filed++;
        if (filedAs === "SHORTCUT") out.shortcuts++;
      }
      void publishTaskChanged(t.id);
    } catch (e) {
      out.warnings.push(`task ${t.id}: ${Meet.googleReason(e)}`);
    }
  }
  if (out.warnings.length) console.warn(`[meeting-notes] ${out.warnings.length} warning(s): ${out.warnings.slice(0, 3).join(" | ")}`);
  return out;
}
