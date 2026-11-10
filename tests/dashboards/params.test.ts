import { describe, it, expect } from "vitest";
import { dashHref, dashTrayCaption, effective, parseDashParams, requestsHref, showsClients, showsTeams, tabForView, viewForTab } from "@/server/dashboards/params";
import { addMonthKey, dashRange, lastMonths } from "@/server/dashboards/period";
import { hrs, inrShort, loadTone, niceMax } from "@/components/dashboards/format";

/** ADR 0016: dashboard URL params, WHEN ranges (Indian FY) and number formats. */
describe("dashboard params", () => {
  it("defaults to Finance · Overview · This month and ignores junk", () => {
    expect(parseDashParams({})).toEqual({ view: "FIN", fin: "ALL", team: null, client: null, period: "MONTH" });
    expect(parseDashParams({ view: "nope", fin: "x", period: "YEAR", team: "bad id!", client: ["c1", "c2"] })).toEqual({ view: "FIN", fin: "ALL", team: null, client: "c1", period: "MONTH" });
    expect(parseDashParams({ view: "TASK", team: "t1", client: "c1", period: "FY" })).toMatchObject({ view: "TASK", team: "t1", client: "c1", period: "FY" });
  });

  it("applies TEAMS to HR + Tasks and CLIENTS to Finance (not Expense) + Tasks", () => {
    const p = parseDashParams({ view: "FIN", team: "t1", client: "c1" });
    expect(effective(p)).toMatchObject({ team: null, client: "c1" });
    expect(effective({ ...p, fin: "EXP" })).toMatchObject({ team: null, client: null });
    expect(effective({ ...p, view: "HR" })).toMatchObject({ team: "t1", client: null });
    expect(effective({ ...p, view: "TASK" })).toMatchObject({ team: "t1", client: "c1" });
    expect([showsTeams({ view: "FIN" }), showsTeams({ view: "HR" }), showsClients({ view: "HR", fin: "ALL" }), showsClients({ view: "FIN", fin: "INC" })]).toEqual([false, true, false, true]);
  });

  it("builds short canonical links that keep filters across views", () => {
    const p = parseDashParams({});
    expect(dashHref(p)).toBe("/admin/dashboards");
    expect(dashHref(p, { view: "HR" })).toBe("/admin/dashboards?view=HR");
    expect(dashHref(p, { view: "TASK", team: "t1", period: "QUARTER" })).toBe("/admin/dashboards?view=TASK&team=t1&period=QUARTER");
    expect(dashHref({ ...p, fin: "INC", client: "c9" }, { view: "TASK" })).toBe("/admin/dashboards?view=TASK&fin=INC&client=c9");
  });

  it("captions the minimised filter tray: view, Finance's Show, the team / client that apply, period", () => {
    const teams = [{ id: "t1", name: "Social" }];
    const clients = [{ id: "c1", name: "Zenith Foods" }];
    const p = parseDashParams({});
    expect(dashTrayCaption(p, teams, clients)).toBe("Filters · Finance · Overview · This month");
    expect(dashTrayCaption({ ...p, client: "c1", team: "t1" }, teams, clients)).toBe("Filters · Finance · Overview · Zenith Foods · This month");
    expect(dashTrayCaption({ ...p, fin: "EXP", client: "c1" }, teams, clients)).toBe("Filters · Finance · Expense · This month");
    expect(dashTrayCaption({ ...p, view: "HR", team: "t1", client: "c1", period: "LAST" }, teams, clients)).toBe("Filters · HR · Social · Last month");
    expect(dashTrayCaption({ ...p, view: "TASK", team: "t1", client: "c1", period: "FY" }, teams, clients)).toBe("Filters · Tasks · Social · Zenith Foods · This FY");
    expect(dashTrayCaption({ ...p, view: "TASK", team: "gone" }, teams, clients)).toBe("Filters · Tasks · This month");
  });

  it("maps request tabs to dashboard views and back", () => {
    expect(["ALL", "FIN", "WORK", "HR"].map((t) => viewForTab(t as never))).toEqual(["FIN", "FIN", "TASK", "HR"]);
    expect(["FIN", "HR", "TASK"].map((v) => tabForView(v as never))).toEqual(["FIN", "HR", "WORK"]);
    expect(requestsHref("ALL")).toBe("/admin/requests");
    expect(requestsHref("HR")).toBe("/admin/requests?tab=HR");
  });
});

describe("WHEN ranges (company timezone)", () => {
  const tz = "Asia/Kolkata";
  const at = (iso: string) => new Date(iso);
  it("this month, last month, 3 months, this FY", () => {
    const now = at("2026-10-10T06:30:00Z");
    expect(dashRange("MONTH", now, tz)).toMatchObject({ fromKey: "2026-10-01", toKey: "2026-10-31", label: "This month", detail: "Oct 2026" });
    expect(dashRange("LAST", now, tz)).toMatchObject({ fromKey: "2026-09-01", toKey: "2026-09-30", detail: "Sep 2026" });
    expect(dashRange("QUARTER", now, tz)).toMatchObject({ fromKey: "2026-08-01", toKey: "2026-10-31", detail: "Aug – Oct" });
    expect(dashRange("FY", now, tz)).toMatchObject({ fromKey: "2026-04-01", toKey: "2026-10-31", detail: "FY 26-27" });
    // start is midnight IST
    expect(dashRange("MONTH", now, tz).start.toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });

  it("wraps years and starts the FY on 1 April (Jan–Mar belong to the previous FY)", () => {
    const jan = at("2027-01-15T06:30:00Z");
    expect(dashRange("LAST", jan, tz).fromKey).toBe("2026-12-01");
    expect(dashRange("QUARTER", jan, tz)).toMatchObject({ fromKey: "2026-11-01", toKey: "2027-01-31" });
    expect(dashRange("FY", jan, tz).fromKey).toBe("2026-04-01");
    expect(dashRange("FY", at("2027-04-02T06:30:00Z"), tz)).toMatchObject({ fromKey: "2027-04-01", detail: "FY 27-28" });
    // 31 March 23:00 IST is still the old FY
    expect(dashRange("FY", at("2027-03-31T17:30:00Z"), tz).fromKey).toBe("2026-04-01");
    expect(addMonthKey("2026-11", 3)).toBe("2027-02");
    expect(lastMonths(jan, tz)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
  });
});

describe("formats", () => {
  it("compact rupees, hours, nice axis maximum, capacity tone", () => {
    expect([inrShort(0), inrShort(950), inrShort(45_000), inrShort(1_20_000), inrShort(3_40_00_000)]).toEqual(["₹0", "₹950", "₹45k", "₹1.2L", "₹3.4Cr"]);
    expect([hrs(0), hrs(90), hrs(690)]).toEqual(["0h", "1.5h", "11.5h"]);
    expect([niceMax(0), niceMax(7), niceMax(40_000), niceMax(1_30_000), niceMax(2_40_000)]).toEqual([1, 10, 50_000, 2_00_000, 2_50_000]);
    expect([loadTone(95), loadTone(80), loadTone(70)]).toEqual(["red", "amber", "ok"]);
  });
});
