import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { settle } from "./helpers";
import type { SessionUser } from "@/lib/rbac";

/**
 * ADR 0017 privacy: the dashboard payload carries only the contact details the viewer may use.
 * Admin: client + all staff · Team Leader: Admin + executives of their tasks · Executive: their TL + Admin.
 */
const session = mockSession();

const CLIENT = { email: "billing@repo.example", contact: "anil@repo.example", phone: "+919876511111", whatsapp: "+919876599999" };
const CLIENT_SECRETS = ["billing@repo.example", "anil@repo.example", "9876511111", "9876599999"];

async function seed() {
  const s = await seedBasics();
  await testDb.client.update({ where: { id: s.client.id }, data: CLIENT });
  const phone = (id: string, p: string) => testDb.user.update({ where: { id }, data: { phone: p } });
  await phone(s.admin.id, "+918910358506");
  await phone(s.tl.id, "+919830011122");
  await phone(s.exec.id, "+919830022233");
  const exec2 = await testDb.user.create({ data: { email: "dev@test.local", name: "Dev Patel", role: "EXECUTIVE", teamId: s.team.id, teamLeaderId: s.tl.id, phone: "+919830033344", activatedAt: new Date() } });
  const other = await testDb.team.create({ data: { name: "SEO" } });
  const otherTl = await testDb.user.create({ data: { email: "neha@test.local", name: "Neha", role: "TEAM_LEADER", teamId: other.id, phone: "+919830044455", activatedAt: new Date() } });
  await testDb.team.update({ where: { id: other.id }, data: { leaderId: otherTl.id } });
  const otherExec = await testDb.user.create({ data: { email: "isha@test.local", name: "Isha", role: "EXECUTIVE", teamId: other.id, teamLeaderId: otherTl.id, phone: "+919830055566", activatedAt: new Date() } });
  const start = new Date(Date.now() + 86400_000);
  const end = new Date(start.getTime() + 3600_000);
  const base = { clientId: s.client.id, createdById: s.admin.id, allocatedMinutes: 60, scheduledStart: start, scheduledEnd: end };
  const work = await testDb.task.create({ data: { ...base, title: "Reel", teams: { create: [{ teamId: s.team.id }] }, assignees: { create: [{ userId: s.exec.id }] } } });
  const meeting = await testDb.task.create({
    data: { ...base, title: "Client sync", type: "MEETING", guestEmails: ["billing@repo.example", "anil@repo.example", "guest@partner.co"], assignees: { create: [{ userId: s.tl.id }, { userId: s.admin.id }] } },
  });
  await testDb.task.create({ data: { ...base, title: "SEO audit", teams: { create: [{ teamId: other.id }] }, assignees: { create: [{ userId: otherExec.id }] } } });
  return { ...s, exec2, other, otherTl, otherExec, work, meeting };
}

const viewer = (u: { id: string; role: SessionUser["role"]; teamId: string | null; teamLeaderId: string | null; name: string }): SessionUser => ({
  id: u.id,
  role: u.role,
  teamId: u.teamId,
  teamLeaderId: u.teamLeaderId,
  name: u.name,
});
const withDetails = (people: { id: string; phone?: string | null; email?: string | null }[]) =>
  people
    .filter((p) => "phone" in p || "email" in p)
    .map((p) => p.id)
    .sort();

describe("dashboard payload: contact details per role (ADR 0017)", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(async () => {
    await settle(100);
  });

  it("Admin gets the client's email / contact / numbers and every staff member's phone and email", async () => {
    const s = await seed();
    const { dashboardData } = await import("@/server/tasks/queries");
    const data = await dashboardData(viewer(s.admin));
    expect(data.clients.find((c) => c.id === s.client.id)).toMatchObject({
      emails: ["billing@repo.example", "anil@repo.example"],
      guestCount: 2,
      contact: CLIENT.contact,
      phone: CLIENT.phone,
      whatsapp: CLIENT.whatsapp,
    });
    expect(withDetails(data.people)).toEqual([s.admin.id, s.tl.id, s.exec.id, s.exec2.id, s.otherTl.id, s.otherExec.id].sort());
    expect(data.people.find((p) => p.id === s.exec.id)).toMatchObject({ phone: "+919830022233", email: "exec@test.local" });
    expect(data.tasks.find((t) => t.id === s.meeting.id)?.guestEmails).toEqual(["billing@repo.example", "anil@repo.example", "guest@partner.co"]);
    expect(data.me.name).toBe("Admin");
    expect(data.companyName).toBeTruthy();
  });

  it("Team Leader: no client detail anywhere; only the Admin's and their tasks' executives' details", async () => {
    const s = await seed();
    const { dashboardData, getTaskRow } = await import("@/server/tasks/queries");
    const data = await dashboardData(viewer(s.tl));
    const json = JSON.stringify(data);
    for (const secret of CLIENT_SECRETS) expect(json).not.toContain(secret);
    expect(data.clients.find((c) => c.id === s.client.id)).toEqual({ id: s.client.id, name: "Repo", guestCount: 2 });
    expect(withDetails(data.people)).toEqual([s.admin.id, s.exec.id].sort()); // exec2 isn't on any of their tasks
    expect(data.people.find((p) => p.id === s.otherTl.id)).not.toHaveProperty("phone");
    const meeting = data.tasks.find((t) => t.id === s.meeting.id);
    expect(meeting).toMatchObject({ guestEmails: ["guest@partner.co"], clientGuestCount: 2 });
    const row = await getTaskRow(viewer(s.tl), s.meeting.id);
    expect(JSON.stringify(row)).not.toContain("repo.example");
  });

  it("Executive: no client detail; only their Team Leader's and the Admin's details", async () => {
    const s = await seed();
    const { dashboardData } = await import("@/server/tasks/queries");
    const data = await dashboardData(viewer(s.exec));
    const json = JSON.stringify(data);
    for (const secret of CLIENT_SECRETS) expect(json).not.toContain(secret);
    expect(withDetails(data.people)).toEqual([s.admin.id, s.tl.id].sort());
    expect(json).not.toContain("9830033344"); // a fellow executive's number
    expect(json).not.toContain("9830044455"); // another team's leader
  });

  it("a Team Leader's meeting can invite the client without ever seeing its addresses", async () => {
    const s = await seed();
    session.set(s.tl);
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ type: "MEETING", title: "Kick-off", clientId: s.client.id, allocatedMinutes: 30, assigneeIds: [s.tl.id], inviteClient: true, guestEmails: ["x@partner.co"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = await testDb.task.findUniqueOrThrow({ where: { id: res.data.taskId } });
    expect(t.guestEmails.sort()).toEqual(["anil@repo.example", "billing@repo.example", "x@partner.co"]);
  });
});
