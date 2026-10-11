/**
 * Notifications · TEAMS and CLIENTS rows (prototype `notifTeam` / `notifClient` / `PAGES.notifications`). Pure and
 * client-safe. A notification belongs to its task's team(s) and client; a money one (no task) to its invoice's
 * client; anything else (leave, vault, TDS…) shows only while both rows are on All. The two rows combine (team AND
 * client), tapping the picked pill again returns to All, and the selection rides in the URL (?team=&client=) next to
 * ?show=. The filter runs in the database, before the row limit (`scopeWhere`). HR and CA get no rows.
 */
import type { Prisma, Role } from "@prisma/client";
import type { FeedFilter } from "@/lib/notification-kinds";

export type FeedScope = { team: string | null; client: string | null };
export const NO_SCOPE: FeedScope = { team: null, client: null };

/** Roles that see the TEAMS / CLIENTS rows (the ones with tasks). */
export const showsFeedScope = (role: Role) => role === "ADMIN" || role === "TEAM_LEADER" || role === "EXECUTIVE";

export const hasScope = (s: FeedScope) => !!(s.team || s.client);

const one = (v: string | string[] | undefined | null): string | null => {
  const s = (Array.isArray(v) ? v[0] : v)?.trim();
  return s ? s : null;
};

/**
 * `?team=&client=` → the selection. Ids not among the offered pills (stale links, another role's) and every id for
 * HR / CA are dropped, so the page never filters by something it cannot show.
 */
export function parseFeedScope(
  sp: { team?: string | string[] | null; client?: string | string[] | null },
  role: Role,
  offered?: { teams: readonly { id: string }[]; clients: readonly { id: string }[] },
): FeedScope {
  if (!showsFeedScope(role)) return NO_SCOPE;
  let team = one(sp.team);
  let client = one(sp.client);
  if (offered && team && !offered.teams.some((t) => t.id === team)) team = null;
  if (offered && client && !offered.clients.some((c) => c.id === client)) client = null;
  return { team, client };
}

/** The feed URL for a tab + selection: `/notifications?show=MONEY&team=…&client=…` (defaults left out). */
export function feedScopeHref(filter: FeedFilter, scope: FeedScope = NO_SCOPE): string {
  const q = new URLSearchParams();
  if (filter !== "ALL") q.set("show", filter);
  if (scope.team) q.set("team", scope.team);
  if (scope.client) q.set("client", scope.client);
  const s = q.toString();
  return s ? `/notifications?${s}` : "/notifications";
}

/** A pill tap: All (null) clears, the picked pill again returns to All, any other pill picks it. */
export const toggleScopeId = (current: string | null, tapped: string | null): string | null => (tapped === null || tapped === current ? null : tapped);

/** Pill text: "Graphic · 3" — the unread count only when there is one. */
export const scopeLabel = (name: string, unread: number) => (unread > 0 ? `${name} · ${unread}` : name);

export type ScopeRef = { taskId: string | null; invoiceId: string | null };
export type ScopeLookup = {
  tasks: ReadonlyMap<string, { clientId: string; teamIds: readonly string[] }>;
  invoices: ReadonlyMap<string, { clientId: string }>;
};

/** Which teams / client a notification belongs to: its task's (when it has one), else its invoice's client. */
export function scopeOf(n: ScopeRef, lookup: ScopeLookup): { teamIds: readonly string[]; clientId: string | null } {
  if (n.taskId) {
    const t = lookup.tasks.get(n.taskId);
    return t ? { teamIds: t.teamIds, clientId: t.clientId } : { teamIds: [], clientId: null };
  }
  if (n.invoiceId) return { teamIds: [], clientId: lookup.invoices.get(n.invoiceId)?.clientId ?? null };
  return { teamIds: [], clientId: null };
}

/** Does a notification pass the TEAMS and CLIENTS rows (both must match when both are picked)? */
export function inScope(n: ScopeRef, scope: FeedScope, lookup: ScopeLookup): boolean {
  if (!hasScope(scope)) return true;
  const s = scopeOf(n, lookup);
  return (!scope.team || s.teamIds.includes(scope.team)) && (!scope.client || s.clientId === scope.client);
}

/** Unread rows per team and per client (the pills' "· N"). A task in two teams counts under both. */
export function scopeCounts(unread: readonly ScopeRef[], lookup: ScopeLookup): { teams: Map<string, number>; clients: Map<string, number> } {
  const teams = new Map<string, number>();
  const clients = new Map<string, number>();
  for (const n of unread) {
    const s = scopeOf(n, lookup);
    for (const t of new Set(s.teamIds)) teams.set(t, (teams.get(t) ?? 0) + 1);
    if (s.clientId) clients.set(s.clientId, (clients.get(s.clientId) ?? 0) + 1);
  }
  return { teams, clients };
}

/**
 * The selection as a Prisma `where` on Notification, given the user's task / invoice ids that match it (resolved in
 * the database by `scopeMatches`). No selection → no condition. Invoice matches only count for rows without a task
 * (a task decides its own team and client) and only when no team is picked (an invoice has no team).
 */
export function scopeWhere(scope: FeedScope, matches: { taskIds: readonly string[]; invoiceIds: readonly string[] }): Prisma.NotificationWhereInput {
  if (!hasScope(scope)) return {};
  const or: Prisma.NotificationWhereInput[] = [{ taskId: { in: [...matches.taskIds] } }];
  if (!scope.team && matches.invoiceIds.length) or.push({ taskId: null, invoiceId: { in: [...matches.invoiceIds] } });
  return { OR: or };
}
