/**
 * Admin dashboards (ADR 0016): URL parameters, labels and href building. Pure — safe for server pages, server queries
 * and client components alike (no Prisma, no "use client").
 *
 * /admin/dashboards?view=FIN|HR|TASK&fin=ALL|INC|EXP&team=<id>&client=<id>&period=MONTH|LAST|QUARTER|FY
 */
export const DASH_VIEWS = ["FIN", "HR", "TASK"] as const;
export const FIN_SHOWS = ["ALL", "INC", "EXP"] as const;
export const PERIODS = ["MONTH", "LAST", "QUARTER", "FY"] as const;

export type DashView = (typeof DASH_VIEWS)[number];
export type FinShow = (typeof FIN_SHOWS)[number];
export type Period = (typeof PERIODS)[number];

export type DashParams = { view: DashView; fin: FinShow; team: string | null; client: string | null; period: Period };

export const VIEW_LABEL: Record<DashView, string> = { FIN: "Finance", HR: "HR", TASK: "Tasks" };
export const VIEW_TITLE: Record<DashView, string> = { FIN: "Finance dashboard", HR: "HR dashboard", TASK: "Task dashboard" };
export const FIN_LABEL: Record<FinShow, string> = { ALL: "Overview", INC: "Income", EXP: "Expense" };
export const PERIOD_LABEL: Record<Period, string> = { MONTH: "This month", LAST: "Last month", QUARTER: "3 months", FY: "This FY" };

/** Which filter rows a view shows (prototype `PAGES.insights`): TEAMS for HR + Tasks, CLIENTS for Finance + Tasks. */
export function showsTeams(p: Pick<DashParams, "view">): boolean {
  return p.view !== "FIN";
}
/** Bills are not tied to clients, so the Expense sub-view has no CLIENTS row (ADR 0016). */
export function showsClients(p: Pick<DashParams, "view" | "fin">): boolean {
  return p.view === "TASK" || (p.view === "FIN" && p.fin !== "EXP");
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : fallback);
const id = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : null);

/**
 * Reads (untrusted) search params; anything unknown falls back to the default. Filters the view doesn't use are kept
 * (so switching Tasks → Finance → Tasks keeps the team) — use `effective()` for what applies.
 */
export function parseDashParams(sp: Record<string, string | string[] | undefined>): DashParams {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]);
  return {
    view: pick(DASH_VIEWS, one("view"), "FIN"),
    fin: pick(FIN_SHOWS, one("fin"), "ALL"),
    team: id(one("team")),
    client: id(one("client")),
    period: pick(PERIODS, one("period"), "MONTH"),
  };
}

/** The filters that actually apply to the view (a team picked on Tasks does not filter Finance). */
export function effective(p: DashParams): DashParams {
  return { ...p, team: showsTeams(p) ? p.team : null, client: showsClients(p) ? p.client : null };
}

/** Canonical URL: defaults are left out so links stay short ("/admin/dashboards?view=HR"). */
export function dashHref(p: DashParams, patch: Partial<DashParams> = {}): string {
  const n = { ...p, ...patch };
  const q = new URLSearchParams();
  if (n.view !== "FIN") q.set("view", n.view);
  if (n.fin !== "ALL") q.set("fin", n.fin);
  if (n.team) q.set("team", n.team);
  if (n.client) q.set("client", n.client);
  if (n.period !== "MONTH") q.set("period", n.period);
  const s = q.toString();
  return `/admin/dashboards${s ? `?${s}` : ""}`;
}

/** Requests inbox tab that belongs to a dashboard view, and back (prototype `reqTab`). */
export type RequestTab = "ALL" | "FIN" | "WORK" | "HR";
export const REQUEST_TABS: RequestTab[] = ["ALL", "FIN", "WORK", "HR"];
export const viewForTab = (t: RequestTab): DashView => (t === "HR" ? "HR" : t === "WORK" ? "TASK" : "FIN");
export const tabForView = (v: DashView): RequestTab => (v === "HR" ? "HR" : v === "TASK" ? "WORK" : "FIN");
export const requestsHref = (t: RequestTab) => (t === "ALL" ? "/admin/requests" : `/admin/requests?tab=${t}`);
