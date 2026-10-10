/**
 * The task's Drive folder (SPEC §8 step 1, ADR 0015): named after the task title, with a "Meeting notes" subfolder
 * where the Gemini notes / transcripts of the task's Meet are filed. Work tasks AND meetings get one.
 */
import { prisma } from "@/lib/db";
import * as Drive from "@/google/drive";

export const MEETING_NOTES_FOLDER = "Meeting notes";

/**
 * Where task folders live, as a Drive path under the app's root folder. The ONE place to change when task folders
 * move (e.g. to the Client kit's per-client "Work" folder): `["Clients", task.client.name, "Work"]`.
 */
export function taskFolderParent(task: { client: { name: string } }): string[] {
  return ["Clients", task.client.name];
}

/** "<task title>"; the short id suffix is added only when that name is already taken in the parent folder. */
export function taskFolderName(title: string, taskId: string, taken: boolean): string {
  const base = title.replace(/\s+/g, " ").trim().slice(0, 180) || "Untitled task";
  return taken ? `${base} – ${taskId.slice(-6)}` : base;
}

type FolderTask = { id: string; title: string; clientId: string; driveFolderId: string | null; meetNotesFolderId: string | null; client: { name: string } };

/** Another task of the same client already uses this title for its folder (mock mode can't ask Drive). */
async function titleTakenInDb(task: FolderTask): Promise<boolean> {
  const n = await prisma.task.count({
    where: { id: { not: task.id }, clientId: task.clientId, title: { equals: task.title, mode: "insensitive" }, driveFolderId: { not: null } },
  });
  return n > 0;
}

/**
 * Idempotent: creates (or completes) the task folder + its "Meeting notes" subfolder and stores both ids.
 * Returns the folder and whether it was newly created (callers then share it with the task's people).
 */
export async function ensureTaskFolder(taskId: string): Promise<{ id: string; url: string; notesFolderId: string; created: boolean }> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    select: { id: true, title: true, clientId: true, driveFolderId: true, driveFolderUrl: true, meetNotesFolderId: true, client: { select: { name: true, driveFolderId: true } } },
  });
  if (task.driveFolderId) {
    const notesFolderId = task.meetNotesFolderId ?? (await Drive.ensureFolder(MEETING_NOTES_FOLDER, task.driveFolderId)).id;
    if (!task.meetNotesFolderId) await prisma.task.update({ where: { id: task.id }, data: { meetNotesFolderId: notesFolderId } });
    return { id: task.driveFolderId, url: task.driveFolderUrl ?? Drive.folderUrl(task.driveFolderId), notesFolderId, created: false };
  }
  const parent = await Drive.ensurePath(taskFolderParent(task));
  const taken = (await titleTakenInDb(task)) || (await Drive.folderExists(taskFolderName(task.title, task.id, false), parent.id));
  const folder = await Drive.ensureFolder(taskFolderName(task.title, task.id, taken), parent.id);
  const notes = await Drive.ensureFolder(MEETING_NOTES_FOLDER, folder.id);
  await prisma.task.update({ where: { id: task.id }, data: { driveFolderId: folder.id, driveFolderUrl: folder.url, meetNotesFolderId: notes.id } });
  if (!task.client.driveFolderId) {
    const root = await Drive.ensurePath(["Clients", task.client.name]);
    await prisma.client.update({ where: { id: task.clientId }, data: { driveFolderId: root.id } });
  }
  return { id: folder.id, url: folder.url, notesFolderId: notes.id, created: true };
}
