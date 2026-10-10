import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { addDays } from "date-fns";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { settle } from "./helpers";

// Spy on the Calendar wrappers (GOOGLE_MOCK keeps the real ones side-effect free).
const cal = vi.hoisted(() => ({ create: [] as unknown[], update: [] as unknown[] }));
vi.mock("@/google/calendar", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/google/calendar")>();
  return {
    ...real,
    createEvent: vi.fn(async (opts: Parameters<typeof real.createEvent>[0]) => {
      cal.create.push(opts);
      return real.createEvent(opts);
    }),
    updateEvent: vi.fn(async (id: string, patch: Parameters<typeof real.updateEvent>[1]) => {
      cal.update.push(patch);
      return real.updateEvent(id, patch);
    }),
  };
});

const session = mockSession();
const TZ = "Asia/Kolkata";
const tomorrowAt = (hhmm: string) => fromZonedTime(`${formatInTimeZone(addDays(new Date(), 1), TZ, "yyyy-MM-dd")}T${hhmm}:00`, TZ);

/** seedBasics (Graphic: TL Rishi + exec Arush) + SEO team (TL Karan + exec Sana) + a client with an email. */
async function seed() {
  const base = await seedBasics();
  const seo = await testDb.team.create({ data: { name: "SEO" } });
  const karan = await testDb.user.create({ data: { email: "Karan@Test.local", name: "Karan Mehta", role: "TEAM_LEADER", teamId: seo.id, activatedAt: new Date() } });
  await testDb.team.update({ where: { id: seo.id }, data: { leaderId: karan.id } });
  const sana = await testDb.user.create({ data: { email: "sana@test.local", name: "Sana Ali", role: "EXECUTIVE", teamId: seo.id, teamLeaderId: karan.id, activatedAt: new Date() } });
  await testDb.user.create({ data: { email: "gone@test.local", name: "Gone", role: "EXECUTIVE", teamId: seo.id, active: false } });
  const client = await testDb.client.update({ where: { id: base.client.id }, data: { email: "Billing@Repo.example" } });
  return { ...base, client, seo, karan, sana };
}

async function createMeeting(raw: Record<string, unknown>) {
  const { createTask } = await import("@/server/tasks/create");
  return createTask({ type: "MEETING", title: "Kickoff", allocatedMinutes: 30, ...raw });
}

describe("meetings: guests, teams and Google Calendar options (ADR 0012)", () => {
  beforeEach(async () => {
    await resetDb();
    cal.create.length = 0;
    cal.update.length = 0;
  });
  afterEach(async () => {
    await settle(150);
  });

  it("an invited team adds only its Team Leader; stores guests deduped and lowercased", async () => {
    const s = await seed();
    session.set(s.admin);
    const res = await createMeeting({
      clientId: s.client.id,
      teamIds: [s.seo.id],
      assigneeIds: [s.exec.id],
      guestEmails: ["billing@repo.example", " Billing@Repo.example ", "Guest@Partner.co"],
      scheduledStart: tomorrowAt("16:00").toISOString(),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = await testDb.task.findUniqueOrThrow({ where: { id: res.data.taskId }, include: { assignees: true, teams: true } });
    expect(t.assignees.map((a) => a.userId).sort()).toEqual([s.admin.id, s.karan.id, s.exec.id].sort()); // not Sana (SEO executive)
    expect(t.teams.map((x) => x.teamId)).toEqual([s.seo.id]);
    expect(t.guestEmails).toEqual(["billing@repo.example", "guest@partner.co"]);
    expect(t.preferredAssigneeIds).toEqual([]);
    expect(t.scheduledEnd!.getTime() - t.scheduledStart!.getTime()).toBe(30 * 60_000);
    // invitees hear about it; the organiser doesn't
    const notified = (await testDb.notification.findMany({ where: { taskId: t.id } })).map((n) => n.userId).sort();
    expect(notified).toEqual([s.karan.id, s.exec.id].sort());
  });

  it("rejects invalid guest emails, unknown teams and meetings with nobody invited", async () => {
    const s = await seed();
    session.set(s.admin);
    const bad = await createMeeting({ clientId: s.client.id, guestEmails: ["ok@x.co", "nope"] });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toContain("Invalid guest email: nope");
    expect(await createMeeting({ clientId: s.client.id, teamIds: ["missing"] })).toEqual({ ok: false, error: "Unknown or inactive team" });
    expect(await createMeeting({ clientId: s.client.id })).toEqual({ ok: false, error: "Invite someone: pick a team, people or add a guest email" });
    const sixReminders = Array.from({ length: 6 }, () => ({ method: "popup", minutes: 10 }));
    const tooMany = await createMeeting({ clientId: s.client.id, guestEmails: ["a@b.co"], meetingOptions: { reminders: sixReminders } });
    expect(tooMany.ok).toBe(false);
    expect(await testDb.task.count()).toBe(0);
    // an external-only meeting is fine (the organiser is the only assignee)
    const solo = await createMeeting({ clientId: s.client.id, guestEmails: ["a@b.co"] });
    expect(solo.ok).toBe(true);
  });

  it("any dashboard role may invite any team; executives too", async () => {
    const s = await seed();
    session.set(s.exec);
    const res = await createMeeting({ clientId: s.client.id, teamIds: [s.seo.id] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = await testDb.task.findUniqueOrThrow({ where: { id: res.data.taskId }, include: { assignees: true } });
    expect(t.assignees.map((a) => a.userId).sort()).toEqual([s.exec.id, s.karan.id].sort());
  });

  it("createEvent gets attendees = organiser + internal + external guests and the mapped options; WORK is unaffected", async () => {
    const s = await seed();
    session.set(s.admin);
    const options = {
      reminders: [{ method: "email", minutes: 1440 }, { method: "popup", minutes: 10 }],
      guestsCanModify: true,
      location: "Studio 2",
      transparency: "transparent",
      visibility: "private",
      colorId: "5",
      timeZone: "Europe/London",
      withMeet: false,
    };
    const res = await createMeeting({ clientId: s.client.id, teamIds: [s.seo.id], guestEmails: ["billing@repo.example", "karan@test.local"], meetingOptions: options, scheduledStart: tomorrowAt("16:00").toISOString() });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { processPending } = await import("@/google/queue");
    await processPending();
    const call = cal.create.at(-1) as { attendees: string[]; options: Record<string, unknown>; timeZone: string };
    expect([...call.attendees].sort()).toEqual(["admin@test.local", "billing@repo.example", "karan@test.local"]);
    expect(call.options).toMatchObject(options);
    expect(call.timeZone).toBe(TZ);
    const t = await testDb.task.findUniqueOrThrow({ where: { id: res.data.taskId } });
    expect(t.calendarEventId).toBeTruthy();
    expect(t.meetLink).toBeNull(); // Meet switched off → plain calendar event
    expect(t.meetingOptions).toMatchObject({ timeZone: "Europe/London", location: "Studio 2" });
  });

  it("company time zone is stored when the options name none; a meeting with Meet gets a link", async () => {
    const s = await seed();
    session.set(s.admin);
    const res = await createMeeting({ clientId: s.client.id, assigneeIds: [s.tl.id], meetingOptions: {} });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { processPending } = await import("@/google/queue");
    await processPending();
    const t = await testDb.task.findUniqueOrThrow({ where: { id: res.data.taskId } });
    expect(t.meetingOptions).toMatchObject({ timeZone: TZ, withMeet: true });
    expect(t.meetLink).toMatch(/^https:\/\/meet\.google\.com\//);
  });

  it("all-day meetings span whole days in the meeting's zone", async () => {
    const s = await seed();
    session.set(s.admin);
    const res = await createMeeting({ clientId: s.client.id, assigneeIds: [s.tl.id], scheduledStart: tomorrowAt("15:00").toISOString(), meetingOptions: { allDay: true } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const t = await testDb.task.findUniqueOrThrow({ where: { id: res.data.taskId } });
    expect(t.scheduledStart!.toISOString()).toBe(tomorrowAt("00:00").toISOString());
    expect(t.scheduledEnd!.getTime() - t.scheduledStart!.getTime()).toBe(24 * 3600_000);
  });

  it("editing a meeting's guests and options re-sends them to Calendar (updateEvent)", async () => {
    const s = await seed();
    session.set(s.admin);
    const res = await createMeeting({ clientId: s.client.id, assigneeIds: [s.tl.id], guestEmails: ["a@b.co"] });
    if (!res.ok) throw new Error(res.error);
    const { processPending } = await import("@/google/queue");
    await processPending();
    const { updateTask } = await import("@/server/tasks/manage");
    const up = await updateTask({ id: res.data.taskId, guestEmails: ["New@Guest.co"], meetingOptions: { location: "Cafe", withMeet: false } });
    expect(up).toEqual({ ok: true, data: undefined });
    await processPending();
    const t = await testDb.task.findUniqueOrThrow({ where: { id: res.data.taskId } });
    expect(t.guestEmails).toEqual(["new@guest.co"]);
    expect(t.meetLink).toBeNull(); // Meet removed
    const patch = cal.update.at(-1) as { attendees: string[]; options: { location: string }; meet?: string };
    expect([...patch.attendees].sort()).toEqual(["admin@test.local", "new@guest.co", "tl@test.local"]);
    expect(patch.options.location).toBe("Cafe");
    expect(patch.meet).toBe("remove");
    expect((await updateTask({ id: res.data.taskId, guestEmails: ["bad"] })).ok).toBe(false);
  });

  it("work tasks ignore guests / options and keep the old attendee set", async () => {
    const s = await seed();
    session.set(s.admin);
    const work = await testDb.workType.create({ data: { name: "Any" } });
    const { createTask } = await import("@/server/tasks/create");
    const res = await createTask({ title: "Reel", clientId: s.client.id, teamIds: [s.team.id], tagIds: [work.id], guestEmails: ["x@y.co"], meetingOptions: { location: "x" } });
    if (!res.ok) throw new Error(res.error);
    const t = await testDb.task.findUniqueOrThrow({ where: { id: res.data.taskId }, include: { assignees: true } });
    expect(t.guestEmails).toEqual([]);
    expect(t.meetingOptions).toBeNull();
    expect(t.assignees.map((a) => a.userId)).toEqual([s.tl.id]);
    const { processPending } = await import("@/google/queue");
    await processPending();
    const call = cal.create.at(-1) as { attendees: string[]; options?: unknown };
    expect(call.options).toBeNull();
    expect(call.attendees).toContain("admin@test.local");
    expect(call.attendees).not.toContain("x@y.co");
  });

  it("recurring meetings: each occurrence keeps the guests and options and gets its own Calendar event", async () => {
    const s = await seed();
    session.set(s.admin);
    const res = await createMeeting({
      clientId: s.client.id,
      assigneeIds: [s.tl.id],
      guestEmails: ["a@b.co"],
      meetingOptions: { location: "Studio" },
      scheduledStart: tomorrowAt("11:00").toISOString(),
      recurrence: { freq: "WEEKLY", ends: "COUNT", count: 3 },
    });
    if (!res.ok) throw new Error(res.error);
    const { spawnNextOccurrence } = await import("@/server/tasks/recurring");
    const next = await spawnNextOccurrence(res.data.taskId, s.admin.id);
    expect(next).toBeTruthy();
    const occ = await testDb.task.findUniqueOrThrow({ where: { id: next! } });
    expect(occ.type).toBe("MEETING");
    expect(occ.guestEmails).toEqual(["a@b.co"]);
    expect(occ.meetingOptions).toMatchObject({ location: "Studio", timeZone: TZ });
    expect((await testDb.integrationJob.findMany({ where: { taskId: next! } })).map((j) => j.kind)).toEqual(["CALENDAR_EVENT"]);
  });

  it("voice notes are refused for meetings", async () => {
    const s = await seed();
    session.set(s.admin);
    const res = await createMeeting({ clientId: s.client.id, assigneeIds: [s.tl.id] });
    if (!res.ok) throw new Error(res.error);
    const { uploadAttachment } = await import("@/server/tasks/manage");
    const fd = new FormData();
    fd.append("taskId", res.data.taskId);
    fd.append("kind", "VOICE_NOTE");
    fd.append("file", new File([new Uint8Array([1, 2, 3])], "v.webm", { type: "audio/webm" }));
    const up = await uploadAttachment(fd);
    expect(up.ok).toBe(false);
    expect(await testDb.taskAttachment.count()).toBe(0);
  });
});

describe("find a time: busy blocks (GOOGLE_MOCK → the app's own tasks)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns each person's scheduled tasks inside 08:00–21:00 of the day", async () => {
    const s = await seed();
    const day = formatInTimeZone(addDays(new Date(), 1), TZ, "yyyy-MM-dd");
    const at = (hhmm: string) => fromZonedTime(`${day}T${hhmm}:00`, TZ);
    const mk = (userId: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
      testDb.task.create({ data: { title: "b", clientId: s.client.id, createdById: s.admin.id, scheduledStart: at(from), scheduledEnd: at(to), assignees: { create: [{ userId }] }, ...extra } });
    await mk(s.tl.id, "10:00", "12:00");
    await mk(s.tl.id, "06:00", "07:00"); // before the window
    await mk(s.exec.id, "14:00", "15:30");
    await mk(s.exec.id, "16:00", "17:00", { status: "COMPLETED" }); // done → not busy
    await mk(s.exec.id, "18:00", "19:00", { deletedAt: new Date() });
    session.set(s.exec);
    const { meetingBusy } = await import("@/server/tasks/meeting-actions");
    const res = await meetingBusy({ userIds: [s.tl.id, s.exec.id], day, timeZone: TZ });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.from).toBe(at("08:00").toISOString());
    expect(res.data.to).toBe(at("21:00").toISOString());
    const [tl, ex] = res.data.people;
    expect(tl).toMatchObject({ id: s.tl.id, source: "tasks", busy: [{ start: at("10:00").toISOString(), end: at("12:00").toISOString() }] });
    expect(ex!.busy).toEqual([{ start: at("14:00").toISOString(), end: at("15:30").toISOString() }]);

    const { suggestSlots } = await import("@/server/tasks/meeting");
    const spans = res.data.people.flatMap((p) => p.busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })));
    const slots = suggestSlots(spans, { start: Date.parse(res.data.from), end: Date.parse(res.data.to) }, 120);
    expect(slots.map((x) => new Date(x.start).toISOString())).toEqual([at("08:00"), at("12:00"), at("15:30")].map((d) => d.toISOString()));
  });

  it("validates input and refuses users without a dashboard", async () => {
    const s = await seed();
    session.set(s.hr);
    const { meetingBusy } = await import("@/server/tasks/meeting-actions");
    expect((await meetingBusy({ userIds: [s.tl.id], day: "2026-10-12" })).ok).toBe(false);
    session.set(s.admin);
    expect((await meetingBusy({ userIds: [], day: "2026-10-12" })).ok).toBe(false);
    expect((await meetingBusy({ userIds: [s.tl.id], day: "12/10/2026" })).ok).toBe(false);
    expect(await meetingBusy({ userIds: [s.hr.id], day: "2026-10-12" })).toEqual({ ok: false, error: "Unknown or inactive guest" });
  });
});
