import { Readable } from "stream";
import { drive, isMock, mockId, withRetry } from "@/google/client";
import { env } from "@/lib/env";

const FOLDER = "application/vnd.google-apps.folder";

export type DriveFolder = { id: string; url: string };

export function folderUrl(id: string) {
  return `https://drive.google.com/drive/folders/${id}`;
}
export function fileUrl(id: string) {
  return `https://drive.google.com/file/d/${id}/view`;
}

/**
 * Folder lookup by name. Without a parent the search is limited to the impersonated user's My Drive root
 * (`'root' in parents`, where `ensureFolder` creates it), so a same-named folder somebody else shared with that user
 * is never picked up by mistake. Shared-drive parents are supported.
 */
async function findChild(name: string, parentId?: string): Promise<string | null> {
  const q = [`name = '${name.replace(/'/g, "\\'")}'`, `mimeType = '${FOLDER}'`, "trashed = false", `'${parentId ?? "root"}' in parents`];
  const res = await withRetry(() =>
    drive().files.list({ q: q.join(" and "), fields: "files(id)", pageSize: 1, supportsAllDrives: true, includeItemsFromAllDrives: true }),
  );
  return res.data.files?.[0]?.id ?? null;
}

/** Idempotent: returns existing folder with that name under parent, else creates it. */
export async function ensureFolder(name: string, parentId?: string): Promise<DriveFolder> {
  if (isMock()) {
    const id = mockId("folder", `${parentId ?? "root"}/${name}`);
    return { id, url: folderUrl(id) };
  }
  const existing = await findChild(name, parentId);
  if (existing) return { id: existing, url: folderUrl(existing) };
  const res = await withRetry(() =>
    drive().files.create({
      requestBody: { name, mimeType: FOLDER, parents: parentId ? [parentId] : undefined },
      fields: "id",
      supportsAllDrives: true,
    }),
  );
  const id = res.data.id!;
  return { id, url: folderUrl(id) };
}

export async function ensurePath(segments: string[]): Promise<DriveFolder> {
  let parent: string | undefined = env.driveRootFolderId || undefined;
  let folder: DriveFolder = { id: parent ?? "root", url: folderUrl(parent ?? "root") };
  for (const seg of segments) {
    folder = await ensureFolder(seg, parent);
    parent = folder.id;
  }
  return folder;
}

export async function shareWith(fileId: string, emails: string[], role: "reader" | "writer" = "writer") {
  if (isMock()) return;
  for (const email of Array.from(new Set(emails.filter(Boolean)))) {
    await withRetry(() =>
      drive().permissions.create({
        fileId,
        requestBody: { type: "user", role, emailAddress: email },
        sendNotificationEmail: false,
        supportsAllDrives: true,
      }),
    ).catch((e: unknown) => {
      const code = (e as { code?: number }).code;
      if (code !== 400 && code !== 409) throw e; // already shared / invalid user are non-fatal
    });
  }
}

/** Mock-mode log of uploads and in-place updates (tests check names and folders). */
export const mockDriveLog: { op: "upload" | "update"; id: string; name: string | null; parentId: string | null; removedParent?: string | null }[] = [];

export async function uploadFile(opts: {
  name: string;
  mimeType: string;
  data: Buffer;
  parentId?: string;
}): Promise<{ id: string; url: string }> {
  if (isMock()) {
    const id = mockId("file", `${opts.parentId}/${opts.name}/${opts.data.length}`);
    mockDriveLog.push({ op: "upload", id, name: opts.name, parentId: opts.parentId ?? null });
    return { id, url: fileUrl(id) };
  }
  const res = await withRetry(() =>
    drive().files.create({
      requestBody: { name: opts.name, parents: opts.parentId ? [opts.parentId] : undefined },
      media: { mimeType: opts.mimeType, body: Readable.from(opts.data) },
      fields: "id",
      supportsAllDrives: true,
    }),
  );
  return { id: res.data.id!, url: fileUrl(res.data.id!) };
}

export async function deleteFile(fileId: string) {
  if (isMock()) return;
  await withRetry(() => drive().files.delete({ fileId, supportsAllDrives: true })).catch((e: unknown) => {
    if ((e as { code?: number }).code !== 404) throw e;
  });
}

/** Mock-mode log of trashed file ids (tests). */
export const trashedMockFiles: string[] = [];

/** Move a file to the Drive trash (recoverable for 30 days); a missing file is ignored. */
export async function trashFile(fileId: string) {
  if (isMock()) {
    trashedMockFiles.push(fileId);
    return;
  }
  await withRetry(() => drive().files.update({ fileId, requestBody: { trashed: true }, supportsAllDrives: true })).catch((e: unknown) => {
    if ((e as { code?: number }).code !== 404) throw e;
  });
}

/** True when the file / folder still exists and is not in the trash (used to repair a client kit). Mock: always true. */
export async function fileAlive(fileId: string): Promise<boolean> {
  if (isMock()) return true;
  try {
    const res = await withRetry(() => drive().files.get({ fileId, fields: "id,trashed", supportsAllDrives: true }));
    return !res.data.trashed;
  } catch (e) {
    const code = (e as { code?: number }).code;
    if (code === 404 || code === 403) return false;
    throw e;
  }
}

/**
 * Rename / move / replace the content of an existing file in one call (a cancelled invoice is renamed to
 * "C Invoice No. …", moved to Cancelled invoices and replaced by the stamped PDF). Returns false when the file no
 * longer exists (404) so the caller can upload a fresh copy instead.
 */
export async function updateFile(opts: { fileId: string; name?: string; addParent?: string; removeParent?: string; mimeType?: string; data?: Buffer }): Promise<boolean> {
  if (isMock()) {
    mockDriveLog.push({ op: "update", id: opts.fileId, name: opts.name ?? null, parentId: opts.addParent ?? null, removedParent: opts.removeParent ?? null });
    return true;
  }
  try {
    await withRetry(() =>
      drive().files.update({
        fileId: opts.fileId,
        requestBody: opts.name ? { name: opts.name } : {},
        addParents: opts.addParent,
        removeParents: opts.removeParent,
        media: opts.data ? { mimeType: opts.mimeType ?? "application/octet-stream", body: Readable.from(opts.data) } : undefined,
        fields: "id",
        supportsAllDrives: true,
      }),
    );
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === 404) return false;
    throw e;
  }
}
