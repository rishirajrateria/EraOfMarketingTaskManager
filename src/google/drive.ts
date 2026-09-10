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

async function findChild(name: string, parentId?: string): Promise<string | null> {
  const q = [`name = '${name.replace(/'/g, "\\'")}'`, `mimeType = '${FOLDER}'`, "trashed = false"];
  if (parentId) q.push(`'${parentId}' in parents`);
  const res = await withRetry(() => drive().files.list({ q: q.join(" and "), fields: "files(id)", pageSize: 1 }));
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

export async function uploadFile(opts: {
  name: string;
  mimeType: string;
  data: Buffer;
  parentId?: string;
}): Promise<{ id: string; url: string }> {
  if (isMock()) {
    const id = mockId("file", `${opts.parentId}/${opts.name}/${opts.data.length}`);
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
