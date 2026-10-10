import { describe, it, expect } from "vitest";
import { NEW_CLIENT_HREF, fabMenu, fabOrder, kitHint, kitHref, sortKitClients } from "@/components/dashboard/fab-model";

/** Bottom-nav "+" speed dial (ADR 0016 addendum): order bottom → top, role filtering, links, the list items' eyes. */
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

  it("links Admin shortcuts to their screens; list items open their list with the add form expanded", () => {
    const links = Object.fromEntries(fabMenu("ADMIN").more.map((i) => [i.key, i.action.kind === "href" ? i.action.href : i.action.kind]));
    expect(links).toEqual({
      INVOICE: "/admin/invoices?new=1&from=add",
      EXPENSE: "/admin/expenses/new?from=add",
      EXECUTIVE: "/admin/people?role=EXECUTIVE&add=1&from=add",
      WORK_TYPE: "/admin/work-types?add=1&from=add",
      TEAM: "/admin/teams?add=1&from=add",
      TEAM_LEADER: "/admin/people?role=TEAM_LEADER&add=1&from=add",
      KIT: "/admin/client-kit?add=1&from=add",
    });
  });

  it("gives the five list items an eye: the same list with the add form minimised, and a View … label", () => {
    const eyes = Object.fromEntries(fabOrder(fabMenu("ADMIN")).filter((i) => i.view).map((i) => [i.key, i.view]));
    expect(eyes).toEqual({
      EXECUTIVE: { href: "/admin/people?role=EXECUTIVE&add=min&from=add", label: "View executives" },
      WORK_TYPE: { href: "/admin/work-types?add=min&from=add", label: "View work types" },
      TEAM: { href: "/admin/teams?add=min&from=add", label: "View teams" },
      TEAM_LEADER: { href: "/admin/people?role=TEAM_LEADER&add=min&from=add", label: "View team leaders" },
      KIT: { href: "/admin/client-kit?add=min&from=add", label: "View client kits" },
    });
  });

  it("has no eye on Task, Meeting, Invoice or Expense, nor for Team Leaders and Executives", () => {
    const plain = fabOrder(fabMenu("ADMIN")).filter((i) => !i.view).map((i) => i.key);
    expect(plain).toEqual(["TASK", "MEETING", "INVOICE", "EXPENSE"]);
    for (const role of ["TEAM_LEADER", "EXECUTIVE"] as const) expect(fabOrder(fabMenu(role)).some((i) => i.view)).toBe(false);
  });

  it("eye and item of a list item point at the same page", () => {
    for (const it of fabMenu("ADMIN").more.filter((i) => i.view)) {
      const open = it.action.kind === "href" ? it.action.href : "";
      expect(it.view!.href.replace("add=min", "add=1")).toBe(open);
    }
  });

  it("gives the add-task strip its short labels (prototype renderAddNav)", () => {
    expect(fabMenu("ADMIN").more.map((i) => i.short)).toEqual(["Invoice", "Expense", "Exec", "Work", "Team", "Leader", "Kit"]);
  });

  it("colours by category: money green, team yellow, client blue", () => {
    const tone = Object.fromEntries(fabOrder(fabMenu("ADMIN")).map((i) => [i.key, i.tone]));
    expect(tone).toMatchObject({ TASK: "task", MEETING: "meet", INVOICE: "money", EXPENSE: "money", EXECUTIVE: "team", WORK_TYPE: "team", TEAM: "team", TEAM_LEADER: "team", KIT: "client" });
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
    expect(NEW_CLIENT_HREF).toBe("/admin/clients?add=1&from=add");
  });
});
