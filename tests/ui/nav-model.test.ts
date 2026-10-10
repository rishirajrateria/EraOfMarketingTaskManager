import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { activeNavKey, addTaskHref, allNavItems, canAdd, FOLDER_LINKS, NAV_HYPH, navHome, navItems, navLabel, navTarget, profileOpen, profileTarget, shownNavKey } from "@/components/shell/nav-model";
import { SOFT_HYPHEN } from "@/components/shell/menu-model";
import { addTaskStore } from "@/components/shell/add-task-store";

/** Bottom nav row of every signed-in screen (ADR 0016 addendum nav v4, prototype `#gNav` / `navActive` / `renderDashNav` / `foldersBtn`). */
const side = (role: Role) => {
  const l = navItems(role);
  return { left: l.left.map((i) => i.key), right: l.right.map((i) => i.key) };
};
const all = (role: Role) => allNavItems(navItems(role));
const item = (role: Role, key: string) => all(role).find((i) => i.key === key)!;

describe("nav items per role (either side of the centred +)", () => {
  it("Admin: Dashboard · Requests · Attendance | + | Notifications · Folders · Home, with their links", () => {
    expect(side("ADMIN")).toEqual({ left: ["DASHBOARD", "REQUESTS", "ATTENDANCE"], right: ["NOTIFICATIONS", "FOLDERS", "HOME"] });
    expect(all("ADMIN").map((i) => [i.label, i.href])).toEqual([
      ["Dashboard", "/admin/dashboards"],
      ["Requests", "/admin/requests"],
      ["Attendance", "/attendance"],
      ["Notifications", "/notifications"],
      ["Folders", "/admin/drive-folders"],
      ["Home", "/dashboard"],
    ]);
  });

  it("Folders: Drive folders (green) and Shared links (blue) with their hints; the tab is also on in the vault", () => {
    expect(FOLDER_LINKS.map((l) => [l.key, l.label, l.hint, l.href])).toEqual([
      ["DRIVE", "Drive folders", "Invoices · bills · GST pack", "/admin/drive-folders"],
      ["SHARED", "Shared links", "Folders shared with clients", "/admin/vault?tab=SHARED_DRIVE_LINK"],
    ]);
    expect(item("ADMIN", "FOLDERS").also).toEqual(["/admin/vault"]);
    // only Admin has it (both pages are Admin's)
    for (const role of ["TEAM_LEADER", "EXECUTIVE", "HR", "CA"] as const) expect(all(role).some((i) => i.key === "FOLDERS")).toBe(false);
  });

  it("Team Leaders, Executives and (parked) CA: Attendance · Notifications | + | Home", () => {
    for (const role of ["TEAM_LEADER", "EXECUTIVE", "CA"] as const) expect(side(role)).toEqual({ left: ["ATTENDANCE", "NOTIFICATIONS"], right: ["HOME"] });
    expect(item("EXECUTIVE", "HOME").href).toBe("/dashboard");
    expect(item("EXECUTIVE", "ATTENDANCE").href).toBe("/attendance");
  });

  it("HR keeps its Requests tab (the leave inbox); its Home is attendance, so it gets no second Attendance tab", () => {
    expect(side("HR")).toEqual({ left: ["REQUESTS", "NOTIFICATIONS"], right: ["HOME"] });
    expect(item("HR", "REQUESTS").href).toBe("/requests/leave");
    expect(item("HR", "HOME").href).toBe("/attendance");
    expect(all("HR").filter((i) => i.href === "/attendance")).toHaveLength(1);
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
    expect(activeNavKey("/attendance", admin)).toBe("ATTENDANCE");
    expect(activeNavKey("/notifications", admin)).toBe("NOTIFICATIONS");
    expect(activeNavKey("/dashboard", admin)).toBe("HOME");
  });

  it("Folders is on for both of its pages (the drive folders and anywhere in the vault)", () => {
    expect(activeNavKey("/admin/drive-folders", admin)).toBe("FOLDERS");
    expect(activeNavKey("/admin/vault", admin)).toBe("FOLDERS");
    expect(activeNavKey("/admin/vault/x", admin)).toBe("FOLDERS");
    expect(activeNavKey("/admin/drive-folders", all("EXECUTIVE"))).toBeNull();
    expect(activeNavKey("/vault", admin)).toBeNull();
  });

  it("matches pages below a tab and ignores a trailing slash", () => {
    expect(activeNavKey("/admin/requests/abc", admin)).toBe("REQUESTS");
    expect(activeNavKey("/notifications/", admin)).toBe("NOTIFICATIONS");
    expect(activeNavKey("/attendance/", all("EXECUTIVE"))).toBe("ATTENDANCE");
  });

  it("is null on every other screen, including look-alike paths and Profile", () => {
    for (const p of ["/", "/me", "/admin/people", "/admin/finance", "/admin/dashboards-old", "/dashboards", "/requests", "/admin/client-kit", "/attendances"]) expect(activeNavKey(p, admin)).toBeNull();
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

  it("Attendance toggles like the other tabs", () => {
    expect(navTarget(item("ADMIN", "ATTENDANCE"), null, "ADMIN")).toBe("/attendance");
    expect(navTarget(item("ADMIN", "ATTENDANCE"), "ATTENDANCE", "ADMIN")).toBe("/dashboard");
    expect(navTarget(item("EXECUTIVE", "ATTENDANCE"), "ATTENDANCE", "EXECUTIVE")).toBe("/dashboard");
    expect(navTarget(item("TEAM_LEADER", "ATTENDANCE"), "HOME", "TEAM_LEADER")).toBe("/attendance");
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

describe("tab labels wrap at a natural break (prototype HYPH)", () => {
  it("soft-hyphenates the long tabs where the prototype does, and leaves short ones alone", () => {
    expect(NAV_HYPH).toEqual({ Dashboard: `Dash${SOFT_HYPHEN}board`, Attendance: `Atten${SOFT_HYPHEN}dance`, Notifications: `Notifi${SOFT_HYPHEN}cations`, Requests: `Re${SOFT_HYPHEN}quests` });
    expect(navLabel("Dashboard")).toBe(`Dash${SOFT_HYPHEN}board`);
    expect(navLabel("Requests")).toBe(`Re${SOFT_HYPHEN}quests`);
    expect(navLabel("Attendance")).toBe(`Atten${SOFT_HYPHEN}dance`);
    expect(navLabel("Notifications")).toBe(`Notifi${SOFT_HYPHEN}cations`);
    for (const short of ["Folders", "Home", "Inventory"]) expect(navLabel(short)).toBe(short);
  });

  it("splits any other word of ten letters or more in the middle, word by word", () => {
    expect(navLabel("Timesheets")).toBe(`Times${SOFT_HYPHEN}heets`);
    expect(navLabel("Dashboard links")).toBe(`Dash${SOFT_HYPHEN}board links`);
    expect(navLabel("Appointments")).toBe(`Appoin${SOFT_HYPHEN}tments`);
    // the plain word survives: aria-labels and titles use it
    for (const i of all("ADMIN")) expect(navLabel(i.label).replace(new RegExp(SOFT_HYPHEN, "g"), "")).toBe(i.label);
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

describe("the add-task screen over the nav (ADR 0016 addendum: the nav stays below it)", () => {
  it("highlights no tab while it is up, the path's tab otherwise", () => {
    expect(shownNavKey("HOME", true)).toBeNull();
    expect(shownNavKey("HOME", false)).toBe("HOME");
    expect(shownNavKey(null, false)).toBeNull();
  });

  it("the sheet reports itself up / gone and subscribers hear each flip once", () => {
    const flips: boolean[] = [];
    const off = addTaskStore.subscribe(() => flips.push(addTaskStore.isShown()));
    expect(addTaskStore.isShown()).toBe(false);
    addTaskStore.setShown(true);
    addTaskStore.setShown(true);
    addTaskStore.setShown(false);
    off();
    addTaskStore.setShown(true);
    addTaskStore.setShown(false);
    expect(flips).toEqual([true, false]);
  });
});
