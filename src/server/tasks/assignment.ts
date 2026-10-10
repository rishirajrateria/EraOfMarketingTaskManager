import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, type SessionUser } from "@/lib/rbac";
import type { TaskInput } from "@/server/tasks/schema";

/**
 * Team-first assignment (ADR 0008). Plain module (no "use server"): shared by createTask, assignExecutives and the
 * add-task inventory. Work types belong to teams; a work type with no teams is a legacy row available to every team.
 */

export const MSG = {
  pickTeam: "Pick a team in the green area",
  pickWork: "Pick a work type in the green area",
  noLeader: "That team has no Team Leader yet (Menu → Add teamleader)",
  noGuests: "Invite someone: pick a team, people or add a guest email",
  prefOutsideTeam: "Preferred executives must be executives of the chosen team",
} as const;

export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "someone";

/** Prisma filter: active work types available to any of `teamIds` (or with no team at all). */
export function workTypesForTeamsWhere(teamIds: string[]): Prisma.WorkTypeWhereInput {
  return { active: true, OR: [{ teams: { none: {} } }, ...(teamIds.length ? [{ teams: { some: { id: { in: teamIds } } } }] : [])] };
}

export async function workTypeIdsForTeams(teamIds: string[]): Promise<string[]> {
  const rows = await prisma.workType.findMany({ where: workTypesForTeamsWhere(teamIds), select: { id: true } });
  return rows.map((r) => r.id);
}

/** Active Team Leaders of the given teams (by membership, falling back to Team.leaderId). */
export async function teamLeaderIds(teamIds: string[]): Promise<string[]> {
  if (!teamIds.length) return [];
  const [members, teams] = await Promise.all([
    prisma.user.findMany({ where: { role: "TEAM_LEADER", active: true, teamId: { in: teamIds } }, select: { id: true }, orderBy: { name: "asc" } }),
    prisma.team.findMany({ where: { id: { in: teamIds } }, select: { leader: { select: { id: true, role: true, active: true } } } }),
  ]);
  const ids = members.map((m) => m.id);
  for (const t of teams) if (t.leader && t.leader.role === "TEAM_LEADER" && t.leader.active && !ids.includes(t.leader.id)) ids.push(t.leader.id);
  return ids;
}

const unique = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

/** Everyone in the given teams: active Team Leader(s) and executives (the add-task capacity header, ADR 0012). */
export async function teamMemberIds(teamIds: string[]): Promise<string[]> {
  if (!teamIds.length) return [];
  const [leaders, execs] = await Promise.all([
    teamLeaderIds(teamIds),
    prisma.user.findMany({ where: { role: "EXECUTIVE", active: true, teamId: { in: teamIds } }, select: { id: true }, orderBy: { name: "asc" } }),
  ]);
  return unique([...leaders, ...execs.map((e) => e.id)]);
}

/**
 * Meetings (ADR 0012), any dashboard role: the organiser + the Team Leader(s) of the invited teams + the people picked
 * in the Guests sheet (anyone with a dashboard may invite anyone; executives are only invited one by one). Teams must
 * exist and be active. External guests are `guestEmails`; at least one invitee besides the organiser is needed.
 */
async function planMeeting(user: SessionUser, input: TaskInput, validate: (ids: string[], type: "WORK" | "MEETING") => Promise<unknown>): Promise<AssignmentPlan> {
  const teamIds = unique(input.teamIds);
  if (teamIds.length) {
    const teams = await prisma.team.count({ where: { id: { in: teamIds }, active: true } });
    if (teams !== teamIds.length) throw new Error("Unknown or inactive team");
  }
  const picked = unique(input.assigneeIds);
  if (picked.length) await validate(picked, "MEETING");
  const assigneeIds = unique([user.id, ...(await teamLeaderIds(teamIds)), ...picked]);
  if (assigneeIds.length === 1 && !input.guestEmails.length) throw new Error(MSG.noGuests);
  const visibleTeams = teamIds.length || user.role === "ADMIN" ? teamIds : user.teamId ? [user.teamId] : [];
  return { assigneeIds, teamIds: visibleTeams, tagIds: [], preferredAssigneeIds: [] };
}

/** WORK tasks need a work type that the relevant teams do. */
async function assertWorkType(tagIds: string[], teamIds: string[]) {
  if (!tagIds.length) throw new Error(MSG.pickWork);
  const allowed = new Set(await workTypeIdsForTeams(teamIds));
  if (!tagIds.every((id) => allowed.has(id))) throw new Error(MSG.pickWork);
}

export type AssignmentPlan = {
  assigneeIds: string[];
  teamIds: string[];
  tagIds: string[];
  preferredAssigneeIds: string[];
};

/**
 * Admin: the task goes to the Team Leader(s) of the chosen team(s); executives can only be suggested
 * (`preferredAssigneeIds`), the Team Leader decides. Team Leader / Executive: assignees as validated by
 * `validate` (own team / self), work type from their own team.
 */
export async function planAssignment(
  user: SessionUser,
  input: TaskInput,
  validate: (ids: string[], type: "WORK" | "MEETING") => Promise<unknown>,
): Promise<AssignmentPlan> {
  if (input.type === "MEETING") return planMeeting(user, input, validate);
  const work = input.type === "WORK";
  const tagIds = work ? unique(input.tagIds) : [];
  if (user.role === "ADMIN") {
    const teamIds = unique(input.teamIds);
    if (!teamIds.length) throw new Error(MSG.pickTeam);
    const teams = await prisma.team.count({ where: { id: { in: teamIds }, active: true } });
    if (teams !== teamIds.length) throw new Error("Unknown or inactive team");
    if (work) await assertWorkType(tagIds, teamIds);
    const leaders = await teamLeaderIds(teamIds);
    if (!leaders.length) throw new Error(MSG.noLeader);
    const extra = unique(input.assigneeIds).filter((id) => !leaders.includes(id));
    if (extra.length) {
      await validate(extra, input.type);
      // Work goes to the chosen teams' leaders (and optionally Admin); meetings may invite anyone.
      if (work && extra.some((id) => id !== user.id)) throw new ForbiddenError("Pick the team — the task goes to its Team Leader");
    }
    const preferredAssigneeIds = unique(input.preferredAssigneeIds);
    if (preferredAssigneeIds.length) {
      const ok = await prisma.user.count({ where: { id: { in: preferredAssigneeIds }, role: "EXECUTIVE", active: true, teamId: { in: teamIds } } });
      if (ok !== preferredAssigneeIds.length) throw new Error(MSG.prefOutsideTeam);
    }
    return { assigneeIds: [...leaders, ...extra], teamIds, tagIds, preferredAssigneeIds };
  }
  if (input.preferredAssigneeIds.length) throw new ForbiddenError("Only Admin sets preferred executives");
  const assigneeIds = unique(input.assigneeIds);
  if (!assigneeIds.length) throw new Error("At least one assignee is required");
  await validate(assigneeIds, input.type);
  const teamIds = unique(input.teamIds.length ? input.teamIds : user.teamId ? [user.teamId] : []);
  if (work) await assertWorkType(tagIds, user.teamId ? [user.teamId] : []);
  return { assigneeIds, teamIds, tagIds, preferredAssigneeIds: [] };
}

/** Members of a task's team(s) that may be assigned from "Assign executive": its Team Leader(s) and executives. */
export async function assignableMembers(teamIds: string[]) {
  if (!teamIds.length) return [];
  const leaders = await teamLeaderIds(teamIds);
  return prisma.user.findMany({
    where: { active: true, OR: [{ id: { in: leaders } }, { role: "EXECUTIVE", teamId: { in: teamIds } }] },
    select: { id: true, name: true, role: true, teamId: true },
  });
}
