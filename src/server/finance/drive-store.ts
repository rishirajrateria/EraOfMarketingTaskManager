import { ensurePath, uploadFile } from "@/google/drive";

type ClientRef = { name: string; driveFolderId?: string | null };
export type StoredFile = { name: string; mimeType: string; data: Buffer };

/** Best-effort upload; never throws (SPEC §14: Google failures must not block the domain action). */
export async function tryUpload(pathSegments: string[] | { folderId: string }, file: StoredFile): Promise<string | null> {
  try {
    const parentId = Array.isArray(pathSegments) ? (await ensurePath(pathSegments)).id : pathSegments.folderId;
    const res = await uploadFile({ name: file.name, mimeType: file.mimeType, data: file.data, parentId });
    return res.id;
  } catch {
    return null;
  }
}

/** Save a document to the client's Drive folder and to the backend Finance/<sub> folder (SPEC §11.3). */
export async function storeForClientAndFinance(client: ClientRef, financeSub: string, file: StoredFile) {
  const [clientFileId, backendFileId] = await Promise.all([
    tryUpload(client.driveFolderId ? { folderId: client.driveFolderId } : ["Clients", client.name], file),
    tryUpload(["Finance", financeSub], file),
  ]);
  return { clientFileId, backendFileId };
}

/** Prisma `Bytes` wants a Uint8Array backed by a plain ArrayBuffer; copying a Buffer guarantees that. */
export const toBytes = (b: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(b);

export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}
