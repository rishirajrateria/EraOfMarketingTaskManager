import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import {
  NO_SCOPE, feedScopeHref, hasScope, inScope, parseFeedScope, scopeCounts, scopeLabel, scopeOf, scopeWhere, showsFeedScope, toggleScopeId, type ScopeLookup,
} from "@/lib/notification-scope";

/** Notifications · TEAMS / CLIENTS rows (prototype `notifTeam` / `notifClient` / `PAGES.notifications`). */
const lookup: ScopeLookup = {
  tasks: new Map([
    ["t1", { clientId: "acme", teamIds: ["graphic"] }],
    ["t2", { clientId: "zen", teamIds: ["graphic", "video"] }],
    ["t3", { clientId: "acme", teamIds: ["video"] }],
  ]),
  invoices: new Map([["i1", { clientId: "acme" }]]),
};
const task = (id: string) => ({ taskId: id, invoiceId: null });
const money = (id: string) => ({ taskId: null, invoiceId: id });
const other = { taskId: null, invoiceId: null };

describe("who gets the rows", () => {
  it("Admin, Team Leader and Executive; not HR or CA", () => {
    expect((["ADMIN", "TEAM_LEADER", "EXECUTIVE"] as Role[]).map(showsFeedScope)).toEqual([true, true, true]);
    expect((["HR", "CA"] as Role[]).map(showsFeedScope)).toEqual([false, false]);
  });
});

describe("parseFeedScope / feedScopeHref (selection in the URL)", () => {
  const offered = { teams: [{ id: "graphic" }, { id: "video" }], clients: [{ id: "acme" }] };
  it("reads ?team= and ?client=, trims, ignores blanks and arrays past the first", () => {
    expect(parseFeedScope({ team: " graphic ", client: "acme" }, "ADMIN")).toEqual({ team: "graphic", client: "acme" });
    expect(parseFeedScope({ team: "", client: undefined }, "EXECUTIVE")).toEqual(NO_SCOPE);
    expect(parseFeedScope({ team: ["video", "graphic"] }, "TEAM_LEADER")).toEqual({ team: "video", client: null });
  });
  it("drops ids that are not offered, and everything for HR / CA", () => {
    expect(parseFeedScope({ team: "ghost", client: "acme" }, "ADMIN", offered)).toEqual({ team: null, client: "acme" });
    expect(parseFeedScope({ team: "graphic", client: "gone" }, "ADMIN", offered)).toEqual({ team: "graphic", client: null });
    expect(parseFeedScope({ team: "graphic", client: "acme" }, "HR", offered)).toEqual(NO_SCOPE);
    expect(parseFeedScope({ team: "graphic" }, "CA")).toEqual(NO_SCOPE);
  });
  it("builds the URL with only what differs from All", () => {
    expect(feedScopeHref("ALL")).toBe("/notifications");
    expect(feedScopeHref("ALL", NO_SCOPE)).toBe("/notifications");
    expect(feedScopeHref("MONEY", { team: null, client: "acme" })).toBe("/notifications?show=MONEY&client=acme");
    expect(feedScopeHref("ALL", { team: "graphic", client: "acme" })).toBe("/notifications?team=graphic&client=acme");
    expect(feedScopeHref("UNREAD", { team: "a b&c", client: null })).toBe("/notifications?show=UNREAD&team=a+b%26c");
  });
});

describe("pills", () => {
  it("tapping the active pill returns to All; another pill picks it; All clears", () => {
    expect(toggleScopeId(null, "graphic")).toBe("graphic");
    expect(toggleScopeId("graphic", "graphic")).toBeNull();
    expect(toggleScopeId("graphic", "video")).toBe("video");
    expect(toggleScopeId("graphic", null)).toBeNull();
  });
  it('label is "Name · N" only when N > 0', () => {
    expect(scopeLabel("Graphic", 3)).toBe("Graphic · 3");
    expect(scopeLabel("Graphic", 0)).toBe("Graphic");
  });
  it("hasScope", () => {
    expect(hasScope(NO_SCOPE)).toBe(false);
    expect(hasScope({ team: "x", client: null })).toBe(true);
    expect(hasScope({ team: null, client: "y" })).toBe(true);
  });
});

describe("scopeOf / inScope (task → its teams + client; money → its invoice's client; others only under All)", () => {
  it("a task's teams and client; a money row's client; nothing for the rest", () => {
    expect(scopeOf(task("t2"), lookup)).toEqual({ teamIds: ["graphic", "video"], clientId: "zen" });
    expect(scopeOf(money("i1"), lookup)).toEqual({ teamIds: [], clientId: "acme" });
    expect(scopeOf(other, lookup)).toEqual({ teamIds: [], clientId: null });
    expect(scopeOf(task("gone"), lookup)).toEqual({ teamIds: [], clientId: null });
    // a task decides on its own: its invoice id is not consulted
    expect(scopeOf({ taskId: "t2", invoiceId: "i1" }, lookup).clientId).toBe("zen");
  });
  it("rows combine (team AND client)", () => {
    const pass = (s: { team: string | null; client: string | null }) =>
      [task("t1"), task("t2"), task("t3"), money("i1"), other].map((n, i) => (inScope(n, s, lookup) ? i : -1)).filter((i) => i >= 0);
    expect(pass(NO_SCOPE)).toEqual([0, 1, 2, 3, 4]);
    expect(pass({ team: "graphic", client: null })).toEqual([0, 1]);
    expect(pass({ team: null, client: "acme" })).toEqual([0, 2, 3]);
    expect(pass({ team: "video", client: "acme" })).toEqual([2]);
    expect(pass({ team: "graphic", client: "nobody" })).toEqual([]);
  });
});

describe("scopeCounts (unread per pill)", () => {
  it("counts each unread row under its team(s) and client; a two-team task counts under both", () => {
    const c = scopeCounts([task("t1"), task("t1"), task("t2"), money("i1"), other, task("gone")], lookup);
    expect(Object.fromEntries(c.teams)).toEqual({ graphic: 3, video: 1 });
    expect(Object.fromEntries(c.clients)).toEqual({ acme: 3, zen: 1 });
  });
  it("a task listing the same team twice still counts once", () => {
    const dup: ScopeLookup = { tasks: new Map([["d", { clientId: "c", teamIds: ["x", "x"] }]]), invoices: new Map() };
    expect(scopeCounts([task("d")], dup).teams.get("x")).toBe(1);
  });
});

describe("scopeWhere (the DB filter, applied before the row limit)", () => {
  const matches = { taskIds: ["t1", "t3"], invoiceIds: ["i1"] };
  it("no selection → no condition", () => {
    expect(scopeWhere(NO_SCOPE, matches)).toEqual({});
  });
  it("client only: matching tasks, or task-less rows on matching invoices", () => {
    expect(scopeWhere({ team: null, client: "acme" }, matches)).toEqual({ OR: [{ taskId: { in: ["t1", "t3"] } }, { taskId: null, invoiceId: { in: ["i1"] } }] });
  });
  it("with a team, invoices never match (they have no team)", () => {
    expect(scopeWhere({ team: "video", client: "acme" }, matches)).toEqual({ OR: [{ taskId: { in: ["t1", "t3"] } }] });
  });
  it("nothing matches → an empty IN (no rows), never 'everything'", () => {
    expect(scopeWhere({ team: "graphic", client: null }, { taskIds: [], invoiceIds: [] })).toEqual({ OR: [{ taskId: { in: [] } }] });
  });
});
