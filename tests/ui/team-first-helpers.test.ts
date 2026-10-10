import { describe, expect, it } from "vitest";
import {
  effectiveAssignees,
  emptyForm,
  fmtShortHours,
  headerTeamIds,
  specialistsFirst,
  syncWorkType,
  toTaskInput,
  toggleAdminTeam,
  validateForm,
  workTypesFor,
} from "@/components/tasks/add-task-helpers";
import { assignCandidates, initialPick } from "@/components/dashboard/AssignExecutiveSheet";
import { taskInputSchema } from "@/server/tasks/schema";
import type { DashboardData, TaskRow } from "@/server/tasks/types";

const people: DashboardData["people"] = [
  { id: "admin", name: "Rishi Rateria", role: "ADMIN", teamId: null, teamLeaderId: null, specialityIds: [] },
  { id: "priya", name: "Priya Sharma", role: "TEAM_LEADER", teamId: "social", teamLeaderId: null, specialityIds: ["content"] },
  { id: "arjun", name: "Arjun Kumar", role: "EXECUTIVE", teamId: "social", teamLeaderId: "priya", specialityIds: ["reels", "ads"] },
  { id: "neha", name: "Neha Verma", role: "EXECUTIVE", teamId: "social", teamLeaderId: "priya", specialityIds: ["content"] },
  { id: "karan", name: "Karan Mehta", role: "TEAM_LEADER", teamId: "graphic", teamLeaderId: null, specialityIds: [] },
  { id: "sana", name: "Sana Ali", role: "EXECUTIVE", teamId: "graphic", teamLeaderId: "karan", specialityIds: ["logo"] },
];
const workTypes: DashboardData["workTypes"] = [
  { id: "content", name: "Content", colour: "#000", teamIds: ["social", "seo"] },
  { id: "logo", name: "Logo", colour: "#000", teamIds: ["graphic"] },
  { id: "reels", name: "Reels", colour: "#000", teamIds: ["social"] },
  { id: "legacy", name: "Legacy", colour: "#000", teamIds: [] },
];
const data = (meId: string) => {
  const me = people.find((p) => p.id === meId)!;
  return { people, workTypes, me: { id: me.id, role: me.role, teamId: me.teamId } };
};
const ids = (list: { id: string }[]) => list.map((x) => x.id);

describe("team-first add-task helpers (ADR 0008)", () => {
  it("workTypesFor: only the teams' work types, plus legacy no-team ones", () => {
    expect(ids(workTypesFor(workTypes, ["graphic"]))).toEqual(["logo", "legacy"]);
    expect(ids(workTypesFor(workTypes, ["social", "graphic"]))).toEqual(["content", "logo", "reels", "legacy"]);
    expect(ids(workTypesFor(workTypes, []))).toEqual(["legacy"]);
  });

  it("syncWorkType keeps a valid pick, else auto-selects the first; Admin with no team has none", () => {
    const admin = data("admin");
    expect(syncWorkType({ ...emptyForm("WORK", "admin", "ADMIN"), tagIds: ["content"] }, admin)).toEqual([]);
    expect(syncWorkType({ ...emptyForm("WORK", "admin", "ADMIN"), teamIds: ["graphic"], tagIds: ["content"] }, admin)).toEqual(["logo"]);
    expect(syncWorkType({ ...emptyForm("WORK", "admin", "ADMIN"), teamIds: ["social"], tagIds: ["reels"] }, admin)).toEqual(["reels"]);
    // Team Leader / Executive: their own team's work types
    expect(syncWorkType(emptyForm("WORK", "sana"), data("sana"))).toEqual(["logo"]);
  });

  it("toggleAdminTeam drops preferences that leave the picked teams", () => {
    const on = toggleAdminTeam({ teamIds: [], preferredAssigneeIds: [] }, { people }, "social");
    expect(on).toEqual({ teamIds: ["social"], preferredAssigneeIds: [] });
    const off = toggleAdminTeam({ teamIds: ["social", "graphic"], preferredAssigneeIds: ["arjun", "sana"] }, { people }, "social");
    expect(off).toEqual({ teamIds: ["graphic"], preferredAssigneeIds: ["sana"] });
  });

  it("effectiveAssignees: Admin → the teams' TLs; TL → picks or the whole team; Exec → self", () => {
    expect(effectiveAssignees({ type: "WORK", teamIds: ["social"], assigneeIds: [] }, data("admin"))).toEqual(["priya"]);
    expect(effectiveAssignees({ type: "WORK", teamIds: ["social", "graphic"], assigneeIds: ["arjun"] }, data("admin"))).toEqual(["priya", "karan"]);
    // Meetings (ADR 0012): me + the invited teams' Team Leaders (not their executives) + picked people
    expect(effectiveAssignees({ type: "MEETING", teamIds: ["social"], assigneeIds: ["sana"] }, data("admin"))).toEqual(["admin", "priya", "sana"]);
    expect(effectiveAssignees({ type: "WORK", teamIds: [], assigneeIds: [] }, data("priya"))).toEqual(["arjun", "neha"]);
    expect(effectiveAssignees({ type: "WORK", teamIds: [], assigneeIds: ["priya", "neha"] }, data("priya"))).toEqual(["priya", "neha"]);
    expect(effectiveAssignees({ type: "WORK", teamIds: [], assigneeIds: ["arjun"] }, data("arjun"))).toEqual(["arjun"]);
  });

  it("headerTeamIds: Admin → the picked teams (none = header hidden); TL / Exec → their own team", () => {
    expect(headerTeamIds({ teamIds: [] }, data("admin"))).toEqual([]);
    expect(headerTeamIds({ teamIds: ["social", "graphic"] }, data("admin"))).toEqual(["social", "graphic"]);
    expect(headerTeamIds({ teamIds: ["graphic"] }, data("priya"))).toEqual(["social"]);
    expect(headerTeamIds({ teamIds: [] }, data("sana"))).toEqual(["graphic"]);
    expect(headerTeamIds({ teamIds: [] }, { me: { id: "x", role: "EXECUTIVE", teamId: null } })).toEqual([]);
  });

  it("fmtShortHours: compact header hours (whole hours from 10h)", () => {
    expect([0, 20, 90, 570, 600, 8430, 37260].map(fmtShortHours)).toEqual(["0h", "0.3h", "1.5h", "9.5h", "10h", "141h", "621h"]);
  });

  it("specialistsFirst is a stable sort", () => {
    const execs = people.filter((p) => p.role === "EXECUTIVE");
    expect(ids(specialistsFirst(execs, "content"))).toEqual(["neha", "arjun", "sana"]);
    expect(ids(specialistsFirst(execs, null))).toEqual(["arjun", "neha", "sana"]);
  });

  it("validateForm with data: prototype messages, in the prototype's order", () => {
    const admin = data("admin");
    const blank = validateForm({ ...emptyForm("WORK", "admin", "ADMIN"), title: "x" }, admin);
    expect(Object.values(blank)[0]).toBe("Pick a team in the green area");
    const noWork = validateForm({ ...emptyForm("WORK", "admin", "ADMIN"), title: "x", teamIds: ["social"], clientId: "c" }, admin);
    expect(noWork).toEqual({ tagIds: "Pick a work type in the green area" });
    const seo = validateForm({ ...emptyForm("MEETING", "admin", "ADMIN"), title: "x", teamIds: ["seo"], clientId: "c" }, admin);
    // Meetings need no Team Leader (ADR 0012), but someone besides the organiser: an empty team invites nobody.
    expect(seo).toEqual({ assigneeIds: "Invite someone: pick a team, people or add a guest email" });
    expect(validateForm({ ...emptyForm("MEETING", "admin", "ADMIN"), title: "x", clientId: "c", guestEmails: ["a@b.co"] }, admin)).toEqual({});
    const ok = validateForm({ ...emptyForm("WORK", "admin", "ADMIN"), title: "x", teamIds: ["social"], tagIds: ["reels"], clientId: "c" }, admin);
    expect(ok).toEqual({});
    expect(validateForm({ ...emptyForm("WORK", "admin", "ADMIN"), title: "x", teamIds: ["social"], tagIds: ["reels"] }, admin)).toEqual({ clientId: "Pick a client in the green area" });
  });

  it("toTaskInput carries the preferences and a payload the server schema accepts", () => {
    const form = { ...emptyForm("WORK", "admin", "ADMIN"), title: "Reel", clientId: "c", teamIds: ["social"], tagIds: ["reels"], preferredAssigneeIds: ["arjun"] };
    const payload = toTaskInput({ ...form, assigneeIds: effectiveAssignees(form, data("admin")) });
    expect(payload).toMatchObject({ assigneeIds: ["priya"], teamIds: ["social"], tagIds: ["reels"], preferredAssigneeIds: ["arjun"] });
    expect(taskInputSchema.safeParse(payload).success).toBe(true);
  });
});

describe("Assign executive sheet helpers", () => {
  const row = (p: Partial<TaskRow>) =>
    ({ teams: [{ id: "social", name: "Social", colour: "#000" }], assignees: [{ id: "priya", name: "Priya Sharma", avatar: null }], preferredAssigneeIds: ["arjun"], ...p }) as TaskRow;

  it("lists the team's TL first, then its executives (TL viewer: own team only)", () => {
    expect(ids(assignCandidates(row({}), { ...data("priya"), role: "TEAM_LEADER" }))).toEqual(["priya", "arjun", "neha"]);
    expect(ids(assignCandidates(row({ teams: [{ id: "graphic", name: "Graphic", colour: "#000" }] }), { ...data("admin"), role: "ADMIN" }))).toEqual(["karan", "sana"]);
  });

  it("pre-selects current executive assignees, else Admin's preferences", () => {
    expect(initialPick(row({}), { people })).toEqual(["arjun"]);
    expect(initialPick(row({ assignees: [{ id: "neha", name: "Neha Verma", avatar: null }] }), { people })).toEqual(["neha"]);
  });
});
