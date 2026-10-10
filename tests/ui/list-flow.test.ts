import { describe, it, expect } from "vitest";
import { LIST_FLOWS, listFlowHref, listFlowState, parseAddState, withAddState } from "@/components/shell/list-flow";

/** The "+" list flow (ADR 0016 addendum, prototype `openListFlow` / `renderPeek`): eye = minimised, item = expanded. */
const params = (q: string) => new URLSearchParams(q);

describe("add state in the URL", () => {
  it("reads ?add=1 as expanded and ?add=min as minimised", () => {
    expect(parseAddState("1")).toBe("open");
    expect(parseAddState("min")).toBe("min");
    for (const v of [null, undefined, "", "0", "true", "MIN"]) expect(parseAddState(v)).toBeNull();
  });

  it("is the list flow only together with from=add (a plain ?add=1 deep link keeps its old meaning)", () => {
    expect(listFlowState(params("role=EXECUTIVE&add=1&from=add"))).toBe("open");
    expect(listFlowState(params("add=min&from=add"))).toBe("min");
    expect(listFlowState(params("add=1"))).toBeNull();
    expect(listFlowState(params("add=min"))).toBeNull();
    expect(listFlowState(params("from=add"))).toBeNull();
    expect(listFlowState(params("add=1&from=menu"))).toBeNull();
    expect(listFlowState(null)).toBeNull();
  });
});

describe("flow links", () => {
  it("opens a list page expanded or minimised, keeping its own query and adding from=add", () => {
    expect(listFlowHref("/admin/teams", "open")).toBe("/admin/teams?add=1&from=add");
    expect(listFlowHref("/admin/teams", "min")).toBe("/admin/teams?add=min&from=add");
    expect(listFlowHref("/admin/people?role=TEAM_LEADER", "min")).toBe("/admin/people?role=TEAM_LEADER&add=min&from=add");
  });

  it("switches expanded ⇄ minimised in place, keeping every other param", () => {
    expect(withAddState("/admin/people", "?role=EXECUTIVE&add=1&from=add", "min")).toBe("/admin/people?role=EXECUTIVE&add=min&from=add");
    expect(withAddState("/admin/work-types", "add=min&from=add", "open")).toBe("/admin/work-types?add=1&from=add");
  });

  it("round-trips: a link's state reads back the same", () => {
    for (const flow of Object.values(LIST_FLOWS)) {
      for (const state of ["open", "min"] as const) expect(listFlowState(params(listFlowHref(flow.base, state).split("?")[1]))).toBe(state);
    }
  });
});

describe("list flows", () => {
  it("names each list's minimised bar and its eye", () => {
    expect(Object.fromEntries(Object.entries(LIST_FLOWS).map(([k, f]) => [k, [f.base, f.peek, f.view]]))).toEqual({
      EXECUTIVE: ["/admin/people?role=EXECUTIVE", "Add executive", "View executives"],
      WORK_TYPE: ["/admin/work-types", "Add work type", "View work types"],
      TEAM: ["/admin/teams", "Add team", "View teams"],
      TEAM_LEADER: ["/admin/people?role=TEAM_LEADER", "Add team leader", "View team leaders"],
      KIT: ["/admin/client-kit", "New client kit", "View client kits"],
    });
  });
});
