/**
 * One requests inbox (ADR 0016): every request belongs to an area — Work (task requests: finish, doubt, review incl.
 * per-pill review, time change, fix self-assigned task) or HR (leave requests and changes to approved leave). Finance
 * items are not Request rows; they come from the hub's "Needs you" (approvals, overdue client invoices, overdue bills).
 * Pure — used by the server query and the inbox UI.
 */
export type RequestArea = "WORK" | "HR";

export function requestArea(type: string): RequestArea {
  return type === "LEAVE" || type === "APPROVED_CHANGE" ? "HR" : "WORK";
}

/** Splits rows by area, keeping their order. */
export function groupByArea<T extends { type: string }>(rows: T[]): Record<RequestArea, T[]> {
  const out: Record<RequestArea, T[]> = { WORK: [], HR: [] };
  for (const r of rows) out[requestArea(r.type)].push(r);
  return out;
}

/** Finance tab sub-filter (?fin=): Approvals (invoices to approve) · Payments (client invoices overdue) · Expenses (bills
 * overdue or due within 7 days). */
export type FinanceGroup = "APPR" | "PAY" | "EXP";
export const FINANCE_GROUPS: FinanceGroup[] = ["APPR", "PAY", "EXP"];
export const FINANCE_GROUP_LABEL: Record<FinanceGroup, string> = { APPR: "Approvals", PAY: "Payments", EXP: "Expenses" };
export const groupOfKind = (kind: "APPROVE" | "OVERDUE" | "BILL"): FinanceGroup => (kind === "APPROVE" ? "APPR" : kind === "OVERDUE" ? "PAY" : "EXP");
export function parseFinanceGroup(v: unknown): FinanceGroup | null {
  return FINANCE_GROUPS.includes(v as FinanceGroup) ? (v as FinanceGroup) : null;
}

/** Tab counts (ADR 0016): finance items (and per sub-group), OPEN work / HR requests. */
export function inboxCounts(i: { finance: { kind: "APPROVE" | "OVERDUE" | "BILL" }[]; work: { status: string }[]; hr: { status: string }[] }) {
  const fin = (g: FinanceGroup) => i.finance.filter((f) => groupOfKind(f.kind) === g).length;
  return { FIN: i.finance.length, WORK: i.work.filter((r) => r.status === "OPEN").length, HR: i.hr.filter((r) => r.status === "OPEN").length, APPR: fin("APPR"), PAY: fin("PAY"), EXP: fin("EXP") };
}

/**
 * The Work tab's Teams / Clients rows (ADR 0016 addendum, prototype `reqTeam` / `reqClient` / `wOk`): `null` = All.
 * Both combine.
 */
export type WorkFilter = { team: string | null; client: string | null };
type WorkRow = { status: string; task: { clientId: string; teamIds: string[] } | null };

/** Does a work request pass the Teams / Clients picks? Its task must be in the team and for the client. */
export function matchesWorkFilter(r: Pick<WorkRow, "task">, f: WorkFilter): boolean {
  if (!f.team && !f.client) return true;
  const t = r.task;
  if (!t) return false;
  return (!f.team || t.teamIds.includes(f.team)) && (!f.client || t.clientId === f.client);
}

/** Pill counts: OPEN work requests whose task is in each team / for each client (each row counts on its own). */
export function workFilterCounts(rows: readonly WorkRow[]): { teams: Record<string, number>; clients: Record<string, number> } {
  const teams: Record<string, number> = {};
  const clients: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== "OPEN" || !r.task) continue;
    for (const id of new Set(r.task.teamIds)) teams[id] = (teams[id] ?? 0) + 1;
    clients[r.task.clientId] = (clients[r.task.clientId] ?? 0) + 1;
  }
  return { teams, clients };
}

/** `?team=` / `?client=` (ids only; anything else = All). */
export function parseWorkFilter(sp: { team?: unknown; client?: unknown }): WorkFilter {
  const id = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
  return { team: id(sp.team), client: id(sp.client) };
}
