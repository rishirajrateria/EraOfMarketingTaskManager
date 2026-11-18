/**
 * The "+" list flow (ADR 0016 addendum, prototype `openListFlow` / `renderPeek` / `.peekbtn`): the speed dial's
 * Executive, Work type, Team, Team leader, Client and Client kit open their list page with the add form either
 * EXPANDED (the item itself, `?add=1`) or MINIMISED to a bar just above the bottom nav (the eye, `?add=min`). Both
 * carry `from=add`, so the form's blue × leaves for the dashboard. Pure URL helpers so tests can check them.
 */

/** `from=add`: the screen was opened by the "+"; its blue × (and, outside the list flow, a save) returns to /dashboard. */
export const FROM_ADD_PARAM = "from";
export const FROM_ADD_VALUE = "add";

export const ADD_PARAM = "add";
/** `open` = the add form is up; `min` = minimised to the bar above the bottom nav. */
export type AddState = "open" | "min";
const ADD_VALUE: Record<AddState, string> = { open: "1", min: "min" };

type Params = { get(name: string): string | null } | null | undefined;

export function parseAddState(value: string | null | undefined): AddState | null {
  return value === ADD_VALUE.open ? "open" : value === ADD_VALUE.min ? "min" : null;
}

/**
 * The flow's state on a list page, or null when the page was opened any other way (a plain `?add=1` deep link from
 * the menu keeps its old meaning: just open the form).
 */
export function listFlowState(params: Params): AddState | null {
  if (!params || params.get(FROM_ADD_PARAM) !== FROM_ADD_VALUE) return null;
  return parseAddState(params.get(ADD_PARAM));
}

/** `base` (a path, optionally with its own query) opened in the flow: `…&add=1|min&from=add`. */
export function listFlowHref(base: string, state: AddState): string {
  const [path, query = ""] = base.split("?");
  const p = new URLSearchParams(query);
  p.set(ADD_PARAM, ADD_VALUE[state]);
  p.set(FROM_ADD_PARAM, FROM_ADD_VALUE);
  return `${path}?${p.toString()}`;
}

/** The same page in another add state (expand ⇄ minimise), keeping every other param. */
export function withAddState(pathname: string, search: string, state: AddState): string {
  const p = new URLSearchParams(search);
  p.set(ADD_PARAM, ADD_VALUE[state]);
  return `${pathname}?${p.toString()}`;
}

export type ListFlowKey = "EXECUTIVE" | "WORK_TYPE" | "TEAM" | "TEAM_LEADER" | "CLIENT" | "KIT";
/** `base` = the list page; `peek` = the minimised bar's label; `view` = the eye's aria-label. */
export type ListFlow = { base: string; peek: string; view: string };

export const LIST_FLOWS: Record<ListFlowKey, ListFlow> = {
  EXECUTIVE: { base: "/admin/people?role=EXECUTIVE", peek: "Add executive", view: "View executives" },
  WORK_TYPE: { base: "/admin/work-types", peek: "Add work type", view: "View work types" },
  TEAM: { base: "/admin/teams", peek: "Add team", view: "View teams" },
  TEAM_LEADER: { base: "/admin/people?role=TEAM_LEADER", peek: "Add team leader", view: "View team leaders" },
  CLIENT: { base: "/admin/clients", peek: "Add client", view: "View clients" },
  KIT: { base: "/admin/client-kit", peek: "New client kit", view: "View client kits" },
};
