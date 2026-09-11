"use server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/rbac";
import { wrap, type ActionResult } from "@/lib/action-result";
import { safeRevalidate } from "@/lib/revalidate";
import {
  parse,
  userInputSchema,
  updateUserSchema,
  teamInputSchema,
  updateTeamSchema,
  clientInputSchema,
  updateClientSchema,
  workTypeInputSchema,
  updateWorkTypeSchema,
} from "@/server/admin/schemas";
import { assertWorkspaceEmail, publicUser, resolveHierarchy, sendInvite, withUnique } from "@/server/admin/people";

/**
 * Admin back-office server actions: people (SPEC §4, §11.7), designations/teams and work types
 * (§11.8) and clients (§11.1 "Add Client"). Every action is ADMIN-only and audited.
 * Company settings live in ./settings-actions.ts.
 */

const PEOPLE = "/admin/people";
const TEAMS = "/admin/teams";
const CLIENTS = "/admin/clients";
const WORK_TYPES = "/admin/work-types";

async function assertLeader(leaderId: string | null): Promise<void> {
  if (!leaderId) return;
  const leader = await prisma.user.findUnique({ where: { id: leaderId }, select: { role: true, active: true } });
  if (!leader || leader.role !== "TEAM_LEADER" || !leader.active) throw new Error("Leader must be an active Team Leader");
}

// ---------- People ----------
export async function createUser(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const input = parse(userInputSchema, raw);
    assertWorkspaceEmail(input.email);
    const refs = await resolveHierarchy(input);
    const user = await withUnique(
      () =>
        prisma.user.create({
          data: {
            email: input.email,
            name: input.name,
            role: input.role,
            teamId: refs.teamId,
            teamLeaderId: refs.teamLeaderId,
            dailyCapacityMinutes: input.dailyCapacityMinutes ?? null,
            workingDays: input.workingDays,
          },
        }),
      "A user with this email already exists",
    );
    await audit(actor.id, "user.create", "User", user.id, null, publicUser(user));
    await sendInvite(user);
    safeRevalidate(PEOPLE, TEAMS);
    return { id: user.id };
  });
}

export async function updateUser(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const input = parse(updateUserSchema, raw);
    const before = await prisma.user.findUnique({ where: { id: input.id } });
    if (!before) throw new Error("User not found");
    if (before.id === actor.id && input.role !== "ADMIN") throw new Error("You cannot change your own role");
    assertWorkspaceEmail(input.email);
    const refs = await resolveHierarchy(input, before.id);
    const after = await withUnique(
      () =>
        prisma.user.update({
          where: { id: before.id },
          data: {
            email: input.email,
            name: input.name,
            role: input.role,
            teamId: refs.teamId,
            teamLeaderId: refs.teamLeaderId,
            dailyCapacityMinutes: input.dailyCapacityMinutes ?? null,
            workingDays: input.workingDays,
          },
        }),
      "A user with this email already exists",
    );
    await audit(actor.id, "user.update", "User", after.id, publicUser(before), publicUser(after));
    safeRevalidate(PEOPLE, TEAMS);
    return { id: after.id };
  });
}

async function setUserActive(id: string, active: boolean): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    if (id === actor.id && !active) throw new Error("You cannot deactivate yourself");
    const before = await prisma.user.findUnique({ where: { id } });
    if (!before) throw new Error("User not found");
    const after = await prisma.user.update({ where: { id }, data: { active } });
    if (!active) await prisma.session.deleteMany({ where: { userId: id } }); // log them out everywhere
    await audit(actor.id, active ? "user.reactivate" : "user.deactivate", "User", id, publicUser(before), publicUser(after));
    safeRevalidate(PEOPLE, TEAMS);
    return { id };
  });
}

export async function deactivateUser(id: string): Promise<ActionResult<{ id: string }>> {
  return setUserActive(id, false);
}

export async function reactivateUser(id: string): Promise<ActionResult<{ id: string }>> {
  return setUserActive(id, true);
}

// ---------- Teams (Designations) ----------
export async function createTeam(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const input = parse(teamInputSchema, raw);
    await assertLeader(input.leaderId);
    const team = await withUnique(() => prisma.team.create({ data: input }), "A designation with this name already exists");
    if (input.leaderId) {
      await prisma.user.updateMany({ where: { id: input.leaderId, teamId: null }, data: { teamId: team.id } });
    }
    await audit(actor.id, "team.create", "Team", team.id, null, team);
    safeRevalidate(TEAMS, PEOPLE);
    return { id: team.id };
  });
}

export async function updateTeam(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const { id, ...input } = parse(updateTeamSchema, raw);
    const before = await prisma.team.findUnique({ where: { id } });
    if (!before) throw new Error("Designation not found");
    await assertLeader(input.leaderId);
    const after = await withUnique(() => prisma.team.update({ where: { id }, data: input }), "A designation with this name already exists");
    if (input.leaderId) {
      await prisma.user.updateMany({ where: { id: input.leaderId, teamId: null }, data: { teamId: id } });
    }
    await audit(actor.id, "team.update", "Team", id, before, after);
    safeRevalidate(TEAMS, PEOPLE);
    return { id };
  });
}

export async function setTeamActive(id: string, active: boolean): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const before = await prisma.team.findUnique({ where: { id } });
    if (!before) throw new Error("Designation not found");
    const after = await prisma.team.update({ where: { id }, data: { active } });
    await audit(actor.id, active ? "team.activate" : "team.deactivate", "Team", id, before, after);
    safeRevalidate(TEAMS);
    return { id };
  });
}

// ---------- Clients ----------
export async function createClient(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const input = parse(clientInputSchema, raw);
    const client = await withUnique(() => prisma.client.create({ data: input }), "A client with this name already exists");
    await audit(actor.id, "client.create", "Client", client.id, null, client);
    safeRevalidate(CLIENTS, "/admin/vault");
    return { id: client.id };
  });
}

export async function updateClient(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const { id, ...input } = parse(updateClientSchema, raw);
    const before = await prisma.client.findUnique({ where: { id } });
    if (!before) throw new Error("Client not found");
    const after = await withUnique(() => prisma.client.update({ where: { id }, data: input }), "A client with this name already exists");
    await audit(actor.id, "client.update", "Client", id, before, after);
    safeRevalidate(CLIENTS, "/admin/vault");
    return { id };
  });
}

export async function setClientActive(id: string, active: boolean): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const before = await prisma.client.findUnique({ where: { id } });
    if (!before) throw new Error("Client not found");
    const after = await prisma.client.update({ where: { id }, data: { active } });
    await audit(actor.id, active ? "client.activate" : "client.deactivate", "Client", id, before, after);
    safeRevalidate(CLIENTS, "/admin/vault");
    return { id };
  });
}

// ---------- Work types ----------
export async function createWorkType(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const input = parse(workTypeInputSchema, raw);
    const wt = await withUnique(() => prisma.workType.create({ data: input }), "A work type with this name already exists");
    await audit(actor.id, "workType.create", "WorkType", wt.id, null, wt);
    safeRevalidate(WORK_TYPES);
    return { id: wt.id };
  });
}

export async function updateWorkType(raw: unknown): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const { id, ...input } = parse(updateWorkTypeSchema, raw);
    const before = await prisma.workType.findUnique({ where: { id } });
    if (!before) throw new Error("Work type not found");
    const after = await withUnique(() => prisma.workType.update({ where: { id }, data: input }), "A work type with this name already exists");
    await audit(actor.id, "workType.update", "WorkType", id, before, after);
    safeRevalidate(WORK_TYPES);
    return { id };
  });
}

export async function setWorkTypeActive(id: string, active: boolean): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const actor = await requireRole("ADMIN");
    const before = await prisma.workType.findUnique({ where: { id } });
    if (!before) throw new Error("Work type not found");
    const after = await prisma.workType.update({ where: { id }, data: { active } });
    await audit(actor.id, active ? "workType.activate" : "workType.deactivate", "WorkType", id, before, after);
    safeRevalidate(WORK_TYPES);
    return { id };
  });
}
