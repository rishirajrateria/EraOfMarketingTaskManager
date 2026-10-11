import { drive, isMock, withRetry } from "@/google/client";

/**
 * Drive API v3 sharing for a folder (ADR 0013), the calls behind the Share sheet that mirrors Google Drive's own
 * dialog: list who has access, add people (optionally notifying them with a message), change a role, remove access,
 * and switch "General access" between Restricted and Anyone with the link. Runs as the impersonated owner
 * (domain-wide delegation). GOOGLE_MOCK keeps permissions in memory so the UI and tests work without Google.
 */
export type ShareRole = "reader" | "commenter" | "writer";
export type PermissionRole = ShareRole | "owner" | "organizer" | "fileOrganizer";
export type DrivePermission = {
  id: string;
  type: "user" | "group" | "domain" | "anyone";
  role: PermissionRole;
  emailAddress: string | null;
  displayName: string | null;
  domain: string | null;
  /**
   * Whether this access comes from a parent folder (Drive `permissionDetails[].inherited`): true = only inherited,
   * false = set on this file, null = Drive did not say (My Drive often omits the details). Mock rows are always direct.
   */
  inherited: boolean | null;
};

const FIELDS = "permissions(id,type,role,emailAddress,displayName,domain,deleted,permissionDetails(inherited))";

// ---------- mock store (on globalThis so every route bundle in `next dev` sees the same permissions) ----------
const g = globalThis as { __eomDriveShareMock?: Map<string, DrivePermission[]> };
const mockStore = (g.__eomDriveShareMock ??= new Map<string, DrivePermission[]>());
let mockSeq = 0;
/** Mock-mode log of notification emails Drive would have sent (tests). */
export const mockShareNotifications: { fileId: string; to: string; role: ShareRole; message: string | null }[] = [];

function mockPerms(fileId: string, owner: string | null): DrivePermission[] {
  let list = mockStore.get(fileId);
  if (!list) {
    list = owner ? [{ id: "owner", type: "user", role: "owner", emailAddress: owner, displayName: null, domain: null, inherited: false }] : [];
    mockStore.set(fileId, list);
  }
  return list;
}

export function resetMockSharing() {
  mockStore.clear();
  mockShareNotifications.length = 0;
  mockSeq = 0;
}

type RawPermission = {
  id?: string | null;
  type?: string | null;
  role?: string | null;
  emailAddress?: string | null;
  displayName?: string | null;
  domain?: string | null;
  permissionDetails?: { inherited?: boolean | null }[] | null;
};

function toPermission(p: RawPermission): DrivePermission {
  const details = p.permissionDetails ?? [];
  return {
    id: p.id ?? "",
    type: (p.type ?? "user") as DrivePermission["type"],
    role: (p.role ?? "reader") as PermissionRole,
    emailAddress: p.emailAddress?.toLowerCase() ?? null,
    displayName: p.displayName ?? null,
    domain: p.domain ?? null,
    inherited: details.length ? details.every((d) => d.inherited === true) : null,
  };
}

/** Everyone with access to the file. `owner` seeds the mock store with the owner row (live Drive reports its own). */
export async function listPermissions(fileId: string, owner: string | null = null): Promise<DrivePermission[]> {
  if (isMock()) return mockPerms(fileId, owner).map((p) => ({ ...p }));
  const out: DrivePermission[] = [];
  let pageToken: string | undefined;
  do {
    const res = await withRetry(() => drive().permissions.list({ fileId, fields: `nextPageToken,${FIELDS}`, supportsAllDrives: true, pageSize: 100, pageToken }));
    for (const p of res.data.permissions ?? []) if (!p.deleted) out.push(toPermission(p));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);
  return out;
}

export type AddResult = { added: string[]; failed: { email: string; error: string }[] };

/** Give each email `role`. With `notify` Drive emails them (with the optional message), like "Notify people". */
export async function addPeople(fileId: string, emails: string[], role: ShareRole, opts: { notify: boolean; message?: string | null; owner?: string | null }): Promise<AddResult> {
  const result: AddResult = { added: [], failed: [] };
  for (const email of Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)))) {
    if (isMock()) {
      const list = mockPerms(fileId, opts.owner ?? null);
      const existing = list.find((p) => p.emailAddress === email);
      if (existing?.role === "owner") {
        result.failed.push({ email, error: "Already the owner" });
        continue;
      }
      if (existing) existing.role = role;
      else list.push({ id: `perm_${++mockSeq}`, type: "user", role, emailAddress: email, displayName: null, domain: null, inherited: false });
      if (opts.notify) mockShareNotifications.push({ fileId, to: email, role, message: opts.message ?? null });
      result.added.push(email);
      continue;
    }
    try {
      await withRetry(() =>
        drive().permissions.create({
          fileId,
          requestBody: { type: "user", role, emailAddress: email },
          sendNotificationEmail: opts.notify,
          emailMessage: opts.notify && opts.message ? opts.message : undefined,
          supportsAllDrives: true,
          fields: "id",
        }),
      );
      result.added.push(email);
    } catch (e) {
      result.failed.push({ email, error: driveError(e) });
    }
  }
  return result;
}

export async function updateRole(fileId: string, permissionId: string, role: ShareRole): Promise<void> {
  if (isMock()) {
    const p = mockStore.get(fileId)?.find((x) => x.id === permissionId);
    if (!p) throw new Error("That person no longer has access");
    p.role = role;
    return;
  }
  await withRetry(() => drive().permissions.update({ fileId, permissionId, requestBody: { role }, supportsAllDrives: true, fields: "id" }));
}

export async function removePermission(fileId: string, permissionId: string): Promise<void> {
  if (isMock()) {
    const list = mockStore.get(fileId) ?? [];
    mockStore.set(fileId, list.filter((p) => p.id !== permissionId));
    return;
  }
  await withRetry(() => drive().permissions.delete({ fileId, permissionId, supportsAllDrives: true })).catch((e: unknown) => {
    if ((e as { code?: number }).code !== 404) throw e;
  });
}

/** General access: "restricted" removes the anyone-with-the-link permission; a role creates or updates it. */
export async function setLinkSharing(fileId: string, access: "restricted" | ShareRole, owner: string | null = null): Promise<void> {
  const anyone = (await listPermissions(fileId, owner)).find((p) => p.type === "anyone");
  if (access === "restricted") {
    if (anyone) await removePermission(fileId, anyone.id);
    return;
  }
  if (anyone) {
    if (anyone.role !== access) await updateRole(fileId, anyone.id, access);
    return;
  }
  if (isMock()) {
    mockPerms(fileId, owner).push({ id: "anyoneWithLink", type: "anyone", role: access, emailAddress: null, displayName: null, domain: null, inherited: false });
    return;
  }
  await withRetry(() => drive().permissions.create({ fileId, requestBody: { type: "anyone", role: access, allowFileDiscovery: false }, supportsAllDrives: true, fields: "id" }));
}

/** A readable message from a googleapis error (e.g. "Bad Request. User message: …" for a non-Google address). */
export function driveError(e: unknown): string {
  const err = e as { errors?: { message?: string }[]; message?: string; code?: number };
  const msg = err.errors?.[0]?.message ?? err.message ?? String(e);
  return msg.length > 160 ? `${msg.slice(0, 157)}…` : msg;
}
