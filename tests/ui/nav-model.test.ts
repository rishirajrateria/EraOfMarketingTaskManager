import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { activeNavKey, addTaskHref, canAdd, navHome, navItems, navTarget } from "@/components/shell/nav-model";
import { addTaskStore } from "@/components/shell/add-task-store";

/** Bottom nav row of every signed-in screen (ADR 0016 addendum, prototype `#gNav` / `navActive` / `renderDashNav`). */
const keys = (role: Role) => navItems(role).map((i) => i.key);
const item = (role: Role, key: string) => navItems(role).find((i) => i.key === key)!;

describe("nav items per role", () => {
  it("Admin: Dashboard · Requests · Notifications · Profile with their links", () => {
    expect(navItems("ADMIN").map((i) => [i.label, i.href])).toEqual([
      ["Dashboard", "/admin/dashboards"],
      ["Requests", "/admin/requests"],
      ["Notifications", "/notifications"],
      ["Profile", "/me"],
    ]);
  });

  it("Team Leaders, Executives and (parked) CA: Notifications and Profile only", () => {
    for (const role of ["TEAM_LEADER", "EXECUTIVE", "CA"] as const) expect(keys(role)).toEqual(["NOTIFICATIONS", "PROFILE"]);
  });

  it("HR keeps its Requests tab (the leave inbox) next to Notifications and Profile", () => {
    expect(navItems("HR").map((i) => [i.key, i.href])).toEqual([
      ["REQUESTS", "/requests/leave"],
      ["NOTIFICATIONS", "/notifications"],
      ["PROFILE", "/me"],
    ]);
  });

  it("shows the + only to roles that add tasks", () => {
    expect((["ADMIN", "TEAM_LEADER", "EXECUTIVE", "HR", "CA"] as const).map(canAdd)).toEqual([true, true, true, false, false]);
  });
});

describe("active tab from the pathname", () => {
  const admin = navItems("ADMIN");

  it("matches each tab's screen", () => {
    expect(activeNavKey("/admin/dashboards", admin)).toBe("DASHBOARD");
    expect(activeNavKey("/admin/requests", admin)).toBe("REQUESTS");
    expect(activeNavKey("/notifications", admin)).toBe("NOTIFICATIONS");
    expect(activeNavKey("/me", admin)).toBe("PROFILE");
  });

  it("matches pages below a tab and ignores a trailing slash", () => {
    expect(activeNavKey("/admin/requests/abc", admin)).toBe("REQUESTS");
    expect(activeNavKey("/notifications/", admin)).toBe("NOTIFICATIONS");
  });

  it("is null on every other screen, including look-alike paths", () => {
    for (const p of ["/dashboard", "/", "/admin/people", "/admin/finance", "/admin/dashboards-old", "/meetings", "/requests", "/admin/client-kit"]) expect(activeNavKey(p, admin)).toBeNull();
  });

  it("follows the role's own links (HR's Requests = the leave inbox; no Dashboard tab for others)", () => {
    expect(activeNavKey("/requests/leave", navItems("HR"))).toBe("REQUESTS");
    expect(activeNavKey("/admin/requests", navItems("HR"))).toBeNull();
    expect(activeNavKey("/admin/dashboards", navItems("EXECUTIVE"))).toBeNull();
  });
});

describe("tab toggle target", () => {
  it("opens a closed tab, and closes the open one back to the task dashboard", () => {
    const req = item("ADMIN", "REQUESTS");
    expect(navTarget(req, null, "ADMIN")).toBe("/admin/requests");
    expect(navTarget(req, "REQUESTS", "ADMIN")).toBe("/dashboard");
  });

  it("tapping another tab while one is open opens that one instead", () => {
    expect(navTarget(item("ADMIN", "NOTIFICATIONS"), "REQUESTS", "ADMIN")).toBe("/notifications");
    expect(navTarget(item("EXECUTIVE", "PROFILE"), "NOTIFICATIONS", "EXECUTIVE")).toBe("/me");
  });

  it("closes to the role's home when it has no task dashboard", () => {
    expect(navHome("ADMIN")).toBe("/dashboard");
    expect(navHome("TEAM_LEADER")).toBe("/dashboard");
    expect(navHome("EXECUTIVE")).toBe("/dashboard");
    expect(navHome("HR")).toBe("/attendance");
    expect(navTarget(item("HR", "NOTIFICATIONS"), "NOTIFICATIONS", "HR")).toBe("/attendance");
  });
});

describe("the +'s Task / Meeting away from the dashboard", () => {
  it("opens the dashboard with its add-task sheet in that mode", () => {
    expect(addTaskHref("WORK")).toBe("/dashboard?add=WORK");
    expect(addTaskHref("MEETING")).toBe("/dashboard?add=MEETING");
  });
});

describe("add-task store (the shell's + reaching the dashboard's sheet)", () => {
  it("opens in place only while the dashboard has registered, and unregisters cleanly", () => {
    expect(addTaskStore.open("WORK")).toBe(false);
    const seen: string[] = [];
    const offOld = addTaskStore.register((m) => seen.push(m));
    expect(addTaskStore.open("MEETING")).toBe(true);
    const offNew = addTaskStore.register((m) => seen.push(`new:${m}`));
    offOld(); // an older dashboard unmounting must not drop the newer one
    expect(addTaskStore.open("WORK")).toBe(true);
    offNew();
    expect(addTaskStore.open("WORK")).toBe(false);
    expect(seen).toEqual(["MEETING", "new:WORK"]);
  });
});
