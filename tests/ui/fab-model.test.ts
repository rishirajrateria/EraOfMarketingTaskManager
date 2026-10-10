import { describe, it, expect } from "vitest";
import { NEW_CLIENT_HREF, dashNavItems, fabMenu, fabOrder, kitHint, kitHref, sortKitClients } from "@/components/dashboard/fab-model";

/** Dashboard "+" speed dial (ADR 0016 addendum): order bottom → top, role filtering, links. */
const keys = (role: Parameters<typeof fabMenu>[0]) => fabOrder(fabMenu(role)).map((i) => i.key);

describe("fab menu model", () => {
  it("puts Task nearest the thumb, then Meeting, then Admin's shortcuts in prototype order", () => {
    expect(keys("ADMIN")).toEqual(["TASK", "MEETING", "INVOICE", "EXPENSE", "EXECUTIVE", "WORK_TYPE", "TEAM", "TEAM_LEADER", "KIT"]);
    expect(fabOrder(fabMenu("ADMIN")).map((i) => i.label)).toEqual(["Task", "Meeting", "Invoice", "Expense", "Executive", "Work type", "Team", "Team leader", "Client kit"]);
  });

  it("gives Team Leaders and Executives Task + Meeting only (no separator group)", () => {
    for (const role of ["TEAM_LEADER", "EXECUTIVE"] as const) {
      expect(keys(role)).toEqual(["TASK", "MEETING"]);
      expect(fabMenu(role).more).toEqual([]);
    }
    expect(fabMenu("ADMIN").main.map((i) => i.key)).toEqual(["TASK", "MEETING"]);
  });

  it("Task / Meeting open the add-task sheet in the right mode and are the big items", () => {
    const [task, meeting] = fabMenu("EXECUTIVE").main;
    expect(task.action).toEqual({ kind: "add", mode: "WORK" });
    expect(meeting.action).toEqual({ kind: "add", mode: "MEETING" });
    expect(task.main && meeting.main).toBe(true);
    expect(meeting.icon).toBeNull(); // Google Meet glyph
    expect(fabMenu("ADMIN").more.every((i) => !i.main)).toBe(true);
  });

  it("links Admin shortcuts to the existing create screens, Client kit to the picker", () => {
    const links = Object.fromEntries(fabMenu("ADMIN").more.map((i) => [i.key, i.action.kind === "href" ? i.action.href : i.action.kind]));
    expect(links).toEqual({
      INVOICE: "/admin/invoices?new=1",
      EXPENSE: "/admin/expenses/new",
      EXECUTIVE: "/admin/people?role=EXECUTIVE&add=1",
      WORK_TYPE: "/admin/work-types?add=1",
      TEAM: "/admin/teams?add=1",
      TEAM_LEADER: "/admin/people?role=TEAM_LEADER&add=1",
      KIT: "kit",
    });
  });

  it("gives the add-task strip its short labels (prototype renderAddNav)", () => {
    expect(fabMenu("ADMIN").more.map((i) => i.short)).toEqual(["Invoice", "Expense", "Exec", "Work", "Team", "Leader", "Kit"]);
  });

  it("colours by category: money green, team yellow, client blue", () => {
    const tone = Object.fromEntries(fabOrder(fabMenu("ADMIN")).map((i) => [i.key, i.tone]));
    expect(tone).toMatchObject({ TASK: "task", MEETING: "meet", INVOICE: "money", EXPENSE: "money", EXECUTIVE: "team", WORK_TYPE: "team", TEAM: "team", TEAM_LEADER: "team", KIT: "client" });
  });
});

describe("dashboard nav row", () => {
  it("Admin: Dashboard · Requests · Notifications · Profile with their links", () => {
    expect(dashNavItems("ADMIN").map((i) => [i.label, i.href])).toEqual([
      ["Dashboard", "/admin/dashboards"],
      ["Requests", "/admin/requests"],
      ["Notifications", "/notifications"],
      ["Profile", "/me"],
    ]);
  });

  it("Team Leaders and Executives: Notifications and Profile only", () => {
    for (const role of ["TEAM_LEADER", "EXECUTIVE"] as const) expect(dashNavItems(role).map((i) => i.key)).toEqual(["NOTIFICATIONS", "PROFILE"]);
  });
});

describe("client kit picker helpers", () => {
  const c = (id: string, ready: boolean, partial = false) => ({ id, name: id, ready, partial });

  it("lists clients without a complete kit first, keeping name order inside each group", () => {
    expect(sortKitClients([c("A", true), c("B", false), c("C", true), c("D", false, true)]).map((x) => x.id)).toEqual(["B", "D", "A", "C"]);
  });

  it("hints what tapping does", () => {
    expect(kitHint(c("A", false))).toBe("Create the kit");
    expect(kitHint(c("A", true))).toBe("Kit ready · open it");
    expect(kitHint(c("A", false, true))).toBe("Kit incomplete · repair it");
  });

  it("goes to the client's kit page, or adds a client", () => {
    expect(kitHref("ck123")).toBe("/admin/client-kit/ck123");
    expect(NEW_CLIENT_HREF).toBe("/admin/clients?add=1");
  });
});
