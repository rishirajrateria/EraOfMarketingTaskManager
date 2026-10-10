import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { activeNavKey, addTaskHref, allNavItems, canAdd, navHome, navItems, navTarget, profileOpen, profileTarget } from "@/components/shell/nav-model";
import { addTaskStore } from "@/components/shell/add-task-store";

/** Bottom nav row of every signed-in screen (ADR 0016 addendum nav v3, prototype `#gNav` / `navActive` / `renderDashNav`). */
const side = (role: Role) => {
  const l = navItems(role);
  return { left: l.left.map((i) => i.key), right: l.right.map((i) => i.key) };
};
const all = (role: Role) => allNavItems(navItems(role));
const item = (role: Role, key: string) => all(role).find((i) => i.key === key)!;

describe("nav items per role (either side of the centred +)", () => {
  it("Admin: Dashboard · Requests | + | Notifications · Home, with their links", () => {
    expect(side("ADMIN")).toEqual({ left: ["DASHBOARD", "REQUESTS"], right: ["NOTIFICATIONS", "HOME"] });
    expect(all("ADMIN").map((i) => [i.label, i.href])).toEqual([
      ["Dashboard", "/admin/dashboards"],
      ["Requests", "/admin/requests"],
      ["Notifications", "/notifications"],
      ["Home", "/dashboard"],
    ]);
  });

  it("Team Leaders, Executives and (parked) CA: Notifications | + | Home", () => {
    for (const role of ["TEAM_LEADER", "EXECUTIVE", "CA"] as const) expect(side(role)).toEqual({ left: ["NOTIFICATIONS"], right: ["HOME"] });
    expect(item("EXECUTIVE", "HOME").href).toBe("/dashboard");
  });

  it("HR keeps its Requests tab (the leave inbox); its Home is attendance", () => {
    expect(side("HR")).toEqual({ left: ["REQUESTS", "NOTIFICATIONS"], right: ["HOME"] });
    expect(item("HR", "REQUESTS").href).toBe("/requests/leave");
    expect(item("HR", "HOME").href).toBe("/attendance");
  });

  it("Profile is not a tab any more (it is the top bar's avatar)", () => {
    for (const role of ["ADMIN", "TEAM_LEADER", "EXECUTIVE", "HR", "CA"] as const) expect(all(role).some((i) => i.href === "/me" && i.key !== "HOME")).toBe(false);
  });

  it("shows the + only to roles that add tasks", () => {
    expect((["ADMIN", "TEAM_LEADER", "EXECUTIVE", "HR", "CA"] as const).map(canAdd)).toEqual([true, true, true, false, false]);
  });
});

describe("active tab from the pathname", () => {
  const admin = all("ADMIN");

  it("matches each tab's screen, Home on the task list", () => {
    expect(activeNavKey("/admin/dashboards", admin)).toBe("DASHBOARD");
    expect(activeNavKey("/admin/requests", admin)).toBe("REQUESTS");
    expect(activeNavKey("/notifications", admin)).toBe("NOTIFICATIONS");
    expect(activeNavKey("/dashboard", admin)).toBe("HOME");
  });

  it("matches pages below a tab and ignores a trailing slash", () => {
    expect(activeNavKey("/admin/requests/abc", admin)).toBe("REQUESTS");
    expect(activeNavKey("/notifications/", admin)).toBe("NOTIFICATIONS");
  });

  it("is null on every other screen, including look-alike paths and Profile", () => {
    for (const p of ["/", "/me", "/admin/people", "/admin/finance", "/admin/dashboards-old", "/dashboards", "/requests", "/admin/client-kit"]) expect(activeNavKey(p, admin)).toBeNull();
  });

  it("follows the role's own links (HR's Requests = the leave inbox, Home = attendance)", () => {
    expect(activeNavKey("/requests/leave", all("HR"))).toBe("REQUESTS");
    expect(activeNavKey("/attendance", all("HR"))).toBe("HOME");
    expect(activeNavKey("/admin/requests", all("HR"))).toBeNull();
    expect(activeNavKey("/admin/dashboards", all("EXECUTIVE"))).toBeNull();
  });
});

describe("tab toggle target", () => {
  it("opens a closed tab, and closes the open one back to the task list", () => {
    const req = item("ADMIN", "REQUESTS");
    expect(navTarget(req, null, "ADMIN")).toBe("/admin/requests");
    expect(navTarget(req, "REQUESTS", "ADMIN")).toBe("/dashboard");
  });

  it("tapping another tab while one is open opens that one instead", () => {
    expect(navTarget(item("ADMIN", "NOTIFICATIONS"), "REQUESTS", "ADMIN")).toBe("/notifications");
    expect(navTarget(item("EXECUTIVE", "NOTIFICATIONS"), "HOME", "EXECUTIVE")).toBe("/notifications");
  });

  it("Home always goes home, also when it is the open one", () => {
    expect(navTarget(item("ADMIN", "HOME"), "REQUESTS", "ADMIN")).toBe("/dashboard");
    expect(navTarget(item("ADMIN", "HOME"), "HOME", "ADMIN")).toBe("/dashboard");
  });

  it("closes to the role's home when it has no task list", () => {
    expect(navHome("ADMIN")).toBe("/dashboard");
    expect(navHome("TEAM_LEADER")).toBe("/dashboard");
    expect(navHome("EXECUTIVE")).toBe("/dashboard");
    expect(navHome("HR")).toBe("/attendance");
    expect(navTarget(item("HR", "NOTIFICATIONS"), "NOTIFICATIONS", "HR")).toBe("/attendance");
  });
});

describe("top bar Profile toggle", () => {
  it("opens /me, and from /me goes home", () => {
    expect(profileOpen("/me")).toBe(true);
    expect(profileOpen("/meetings")).toBe(false);
    expect(profileTarget("/admin/finance", "ADMIN")).toBe("/me");
    expect(profileTarget("/me", "ADMIN")).toBe("/dashboard");
    expect(profileTarget("/me/", "EXECUTIVE")).toBe("/dashboard");
    expect(profileTarget("/me", "HR")).toBe("/attendance");
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
