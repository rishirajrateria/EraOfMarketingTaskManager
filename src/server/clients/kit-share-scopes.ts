import type { DrivePermission, ShareRole } from "@/google/drive-share";
import type { KitIds } from "@/server/clients/kit-paths";

/**
 * Pure helpers for the client kit Share sheet (ADR 0014, "Sharing a kit"): which parts of a kit can be shared, how
 * a sub-folder's access splits into "set here" and "via the whole kit", and the one-tap team suggestions. No I/O, so
 * they run on the server and in the browser.
 */
export const KIT_SCOPE_KEYS = ["kit", "brand", "sheet", "work", "reports"] as const;
export type KitScopeKey = (typeof KIT_SCOPE_KEYS)[number];

/** One "What to share" pill: the whole kit, a sub-folder, or the credentials Google Sheet. */
export type KitScope = { key: KitScopeKey; name: string; label: string; fileId: string; kind: "folder" | "sheet" };
/** What the browser needs to draw the pills (file ids stay on the server). */
export type KitScopeOption = Pick<KitScope, "key" | "name" | "label">;

/**
 * The parts of this client's kit that exist, in pill order: Whole kit, then the four parts named from Settings. The
 * Credentials pill shares the credentials sheet (that is what the client opens), not its folder.
 */
export function kitShareScopes(ids: KitIds, folders: readonly [string, string, string, string], displayName: string): KitScope[] {
  if (!ids.kitFolderId) return [];
  const [brand, creds, work, reports] = folders;
  const parts: [KitScopeKey, string | null | undefined, string, KitScope["kind"]][] = [
    ["brand", ids.kitBrandId, brand, "folder"],
    ["sheet", ids.kitSheetId, `${creds} sheet`, "sheet"],
    ["work", ids.kitWorkId, work, "folder"],
    ["reports", ids.kitReportsId, reports, "folder"],
  ];
  return [
    { key: "kit", name: "Whole kit", label: `Client kit › ${displayName}`, fileId: ids.kitFolderId, kind: "folder" },
    ...parts.filter(([, id]) => Boolean(id)).map(([key, id, name, kind]) => ({ key, name, label: `${displayName} › ${name}`, fileId: id!, kind })),
  ];
}

export const scopeOptions = (scopes: KitScope[]): KitScopeOption[] => scopes.map(({ key, name, label }) => ({ key, name, label }));

export const scopeUrl = (s: Pick<KitScope, "fileId" | "kind">) =>
  s.kind === "sheet" ? `https://docs.google.com/spreadsheets/d/${s.fileId}/edit` : `https://drive.google.com/drive/folders/${s.fileId}`;

const isOwnerRole = (role: string) => role === "owner" || role === "organizer";
const samePerson = (a: DrivePermission, b: DrivePermission) =>
  a.id === b.id || (a.type === b.type && ((a.emailAddress !== null && a.emailAddress === b.emailAddress) || (a.type === "domain" && a.domain === b.domain)));

export type ScopeAccess = {
  /** Set on this file (plus the owner): role can be changed or removed here. */
  direct: DrivePermission[];
  /** Only reaches this part through the whole kit: shown read-only as "Editor · whole kit". */
  inherited: DrivePermission[];
  /** "Anyone with the link" set on this file, if any. */
  link: DrivePermission | null;
  /** Role of the whole kit's "Anyone with the link" when this part has none of its own. */
  inheritedLink: ShareRole | null;
};

/**
 * Splits a part's permissions using the whole kit's list. Drive's `inherited` flag wins when present; otherwise a row
 * the kit also grants with the same role is treated as coming from the kit (live My Drive lists inherited access on
 * children without saying so). The mock keeps only direct rows per file, so kit people are added from `kitPerms`.
 * `kitPerms` is null for the whole kit itself.
 */
export function splitAccess(scopePerms: DrivePermission[], kitPerms: DrivePermission[] | null): ScopeAccess {
  const kit = kitPerms ?? [];
  const fromKit = (p: DrivePermission) => {
    if (!kitPerms || isOwnerRole(p.role)) return false;
    if (p.inherited !== null) return p.inherited;
    return kit.some((k) => samePerson(k, p) && k.role === p.role);
  };
  const direct = scopePerms.filter((p) => p.type !== "anyone" && !fromKit(p));
  const inherited = kit.filter((k) => k.type !== "anyone" && !isOwnerRole(k.role) && !direct.some((d) => samePerson(d, k)));
  const link = scopePerms.find((p) => p.type === "anyone" && !fromKit(p)) ?? null;
  const kitLink = kit.find((k) => k.type === "anyone");
  const inheritedLink = !link && kitLink && isShareRole(kitLink.role) ? kitLink.role : null;
  return { direct, inherited, link, inheritedLink };
}

export const isShareRole = (r: string): r is ShareRole => r === "reader" || r === "commenter" || r === "writer";

export type TeamMember = { id: string; name: string; email: string; role: string };

/** Active Team leaders and Executives who don't already have direct access here and aren't being added. */
export function teamSuggestions(team: TeamMember[], taken: Iterable<string | null>): TeamMember[] {
  const skip = new Set(Array.from(taken, (e) => (e ?? "").toLowerCase()).filter(Boolean));
  return team
    .filter((u) => (u.role === "TEAM_LEADER" || u.role === "EXECUTIVE") && !skip.has(u.email.toLowerCase()))
    .sort((a, b) => Number(b.role === "TEAM_LEADER") - Number(a.role === "TEAM_LEADER") || a.name.localeCompare(b.name));
}

export const ROLE_TAG: Record<string, string> = { TEAM_LEADER: "Team leader", EXECUTIVE: "Executive", ADMIN: "Admin", HR: "HR", CA: "Accountant" };
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
