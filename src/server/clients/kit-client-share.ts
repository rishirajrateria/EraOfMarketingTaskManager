import type { ShareRole } from "@/google/drive-share";
import { addPeople, removePersonAccess } from "@/google/drive-share";
import type { KitIds } from "@/server/clients/kit-paths";

/**
 * What a client may open in their kit (ADR 0020, "only client-facing folders"): Brand kit (Editor, they upload),
 * the Credentials sheet (Editor, they fill it), Reports (Viewer) and Final work (Viewer — Admin puts approved
 * deliverables there). The kit root, Credentials folder and Work (task folders, Gemini meeting notes) are NEVER shared
 * with the client. Drive access flows down, so the client is added to these four items individually, never to the root.
 */
export type ClientShareKey = "brand" | "sheet" | "reports" | "final";
export type ClientShareTarget = { key: ClientShareKey; fileId: string; role: ShareRole };

export function clientShareTargets(ids: KitIds): ClientShareTarget[] {
  const all: [ClientShareKey, string | null | undefined, ShareRole][] = [
    ["brand", ids.kitBrandId, "writer"],
    ["sheet", ids.kitSheetId, "writer"],
    ["reports", ids.kitReportsId, "reader"],
    ["final", ids.kitFinalId, "reader"],
  ];
  return all.filter(([, id]) => Boolean(id)).map(([key, id, role]) => ({ key, fileId: id!, role }));
}

/** Files the client must not have access to: the kit root, the Credentials folder and Work. */
export function clientHiddenFiles(ids: KitIds): string[] {
  return [ids.kitFolderId, ids.kitCredentialsId, ids.kitWorkId].filter((x): x is string => Boolean(x));
}

/** Every file of the kit (used to revoke a former / deactivated client everywhere). */
export function allKitFiles(ids: KitIds): string[] {
  return Array.from(new Set([...clientHiddenFiles(ids), ...clientShareTargets(ids).map((t) => t.fileId)]));
}

export type ClientShareInput = KitIds & { email: string | null; active: boolean; kitSharedWith: string | null };
export type ClientShareResult = {
  /** Who now has client-facing access (null = nobody). When revoking a former address failed it stays recorded here so a retry can finish the job. */
  sharedWith: string | null;
  granted: string[];
  revoked: { email: string; fileId: string }[];
  warnings: string[];
};

const norm = (e: string | null | undefined) => e?.trim().toLowerCase() || null;

async function revokeFrom(email: string, files: string[], owner: string | null, out: ClientShareResult): Promise<boolean> {
  let ok = true;
  for (const fileId of files) {
    try {
      if ((await removePersonAccess(fileId, email, owner)) > 0) out.revoked.push({ email, fileId });
    } catch (e) {
      ok = false;
      out.warnings.push(`Could not remove ${email} from a kit folder: ${e instanceof Error ? e.message : String(e)}. Tap Fix sharing to retry.`);
    }
  }
  return ok;
}

/**
 * Makes Drive match the rule above. Idempotent, safe to repeat ("Fix sharing"):
 * - a previously shared address that is no longer the client's email (changed email) loses access to the whole kit;
 * - an inactive client, or one without an email, has nobody shared at all;
 * - the current email is removed from the root / Credentials folder / Work (repairing old whole-kit sharing) and
 *   added to the client-facing items. Drive's own notification mail is off; a non-Google address falls back to
 *   Drive's invitation mail because Drive refuses it silently otherwise.
 */
export async function syncClientSharing(c: ClientShareInput, opts: { owner: string | null; companyName: string }): Promise<ClientShareResult> {
  const out: ClientShareResult = { sharedWith: null, granted: [], revoked: [], warnings: [] };
  const want = c.active ? norm(c.email) : null;
  const previous = norm(c.kitSharedWith);
  const everywhere = allKitFiles(c);
  let staleLeft: string | null = null;

  if (previous && previous !== want) {
    if (!(await revokeFrom(previous, everywhere, opts.owner, out))) staleLeft = previous;
  }
  if (!want) {
    if (c.active && !c.email?.trim()) out.warnings.push("No client email on file: nothing is shared with the client yet.");
    out.sharedWith = staleLeft;
    return out;
  }
  await revokeFrom(want, clientHiddenFiles(c), opts.owner, out);
  for (const t of clientShareTargets(c)) {
    let r = await addPeople(t.fileId, [want], t.role, { notify: false, owner: opts.owner });
    if (r.added.length === 0) r = await addPeople(t.fileId, [want], t.role, { notify: true, message: `${opts.companyName} shared a client folder with you.`, owner: opts.owner });
    if (r.added.length) out.granted.push(t.key);
    else out.warnings.push(`Could not share ${t.key} with ${want}: ${r.failed[0]?.error ?? "unknown error"}. Use Share to add them.`);
  }
  out.sharedWith = staleLeft ?? (out.granted.length ? want : null);
  return out;
}
