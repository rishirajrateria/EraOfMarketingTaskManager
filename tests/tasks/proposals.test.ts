/**
 * ADR 0021 — Team Leader task proposals: a TL's work task waits for Admin (no time held, nothing booked, no Google
 * items), Admin approves / edits & approves / rejects with a note, the TL may withdraw. Time is frozen on Monday
 * 12 Oct 2026, 09:00 in Asia/Kolkata (working days Mon–Sat, 10:00–19:00, lunch 13:30–14:30).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { anyTeamWorkType, loadTask, settle } from "./helpers";
import { parseDateKey, zonedDayAt } from "@/lib/time";

const session = mockSession();
const TZ = "Asia/Kolkata";
const MON = "2026-10-12";
const TUE = "2026-10-13";
const at = (key: string, hhmm: string) => zonedDayAt(parseDateKey(key, TZ), Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
let s: Awaited<ReturnType<typeof seedBasics>>;
let workId: string;

async function propose(raw: Record<string, unknown> = {}) {
  session.set(s.tl);
  const { createTask } = await import("@/server/tasks/create");
  const res = await createTask({ title: "Festive reel scripts", clientId: s.client.id, allocatedMinutes: 60, tagIds: [workId], ...raw });
  if (!res.ok) throw new Error(res.error);
  expect(res.data.proposal).toBe(true);
  return res.data.taskId;
}

const jobsOf = async (taskId: string) => (await testDb.integrationJob.findMany({ where: { taskId } })).map((j) => j.kind);
const notesOf = (taskId: string, userId: string) => testDb.notification.findMany({ where: { taskId, userId }, orderBy: { createdAt: "asc" } });

describe("Team Leader proposals (ADR 0021)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(MON, "09:00"));
    await resetDb();
    s = await seedBasics();
    workId = (await anyTeamWorkType()).id;
    (await import("@/lib/settings")).invalidateSettingsCache();
  });
  afterEach(async () => {
    await settle(120);
    vi.useRealTimers();
  });

  it("TL create → PENDING_APPROVAL: no assignee, no time, no Google jobs, nothing booked; Admin is told; a TASK_PROPOSAL request opens", async () => {
    const id = await propose({ scheduledStart: at(TUE, "15:00").toISOString() });
    await settle(60);
    const t = await loadTask(id);
    expect(t).toMatchObject({ status: "PENDING_APPROVAL", proposedById: s.tl.id, scheduledStart: null, scheduledEnd: null, requestedDate: TUE, requestedTime: "15:00" });
    expect(t.assignees).toEqual([]);
    expect(await jobsOf(id)).toEqual([]);
    expect(t.requests.map((r) => [r.type, r.status, r.raisedById])).toEqual([["TASK_PROPOSAL", "OPEN", s.tl.id]]);
    const admin = await notesOf(id, s.admin.id);
    expect(admin.map((n) => [n.kind, n.title])).toEqual([["TASK_PROPOSED", "New proposal from Rishi"]]);
    expect(await testDb.notification.count({ where: { taskId: id, userId: s.tl.id } })).toBe(0);

    // capacity, inventory, busy time and the overdue job never see it
    const { inventoryFor } = await import("@/server/inventory/queries");
    const inv = await inventoryFor({ from: parseDateKey(MON, TZ), to: parseDateKey(TUE, TZ) }, { userId: s.tl.id });
    expect(inv.rows.reduce((a, r) => a + r.assignedMinutes, 0)).toBe(0);
    const { addTaskInventory } = await import("@/server/tasks/create");
    const header = await addTaskInventory([s.team.id]);
    expect(header.ok && header.data.week).toMatchObject({ bookedMinutes: 0, count: 0 });
    const { busyFor } = await import("@/server/scheduling/slot");
    expect((await busyFor(s.tl.id, at(MON, "00:00"), at("2026-10-20", "00:00"), { requesterRole: "ADMIN", requesterId: s.admin.id })).hard).toEqual([]);
    const { taskDashboard } = await import("@/server/dashboards/tasks");
    expect((await taskDashboard({ team: null, client: null, period: "MONTH" })).open).toBe(0);
  });

  it("the TL sees it as a proposal; Executives and other Team Leaders never do; Admin does", async () => {
    const id = await propose();
    const other = await testDb.user.create({ data: { email: "tl2@test.local", name: "Second TL", role: "TEAM_LEADER", teamId: s.team.id, activatedAt: new Date() } });
    const { listTasks } = await import("@/server/tasks/queries");
    const tl = await listTasks({ id: s.tl.id, role: "TEAM_LEADER", teamId: s.team.id, teamLeaderId: null }, { includeCompleted: true });
    expect(tl.find((t) => t.id === id)?.proposal).toEqual({ byId: s.tl.id, requestedDate: null, requestedTime: null });
    expect((await listTasks({ id: other.id, role: "TEAM_LEADER", teamId: s.team.id, teamLeaderId: null })).some((t) => t.id === id)).toBe(false);
    expect((await listTasks({ id: s.exec.id, role: "EXECUTIVE", teamId: s.team.id, teamLeaderId: s.tl.id }, { includeCompleted: true })).some((t) => t.id === id)).toBe(false);
    expect((await listTasks({ id: s.admin.id, role: "ADMIN", teamId: null, teamLeaderId: null }, { includeCompleted: true })).find((t) => t.id === id)?.status).toBe("PENDING_APPROVAL");
  });

  it("Admin approve → ASSIGNED to the TL at the requested time when free, Google jobs queued, TL told, request approved", async () => {
    const id = await propose({ scheduledStart: at(TUE, "15:00").toISOString() });
    session.set(s.admin);
    const { approveProposal } = await import("@/server/tasks/proposals");
    const res = await approveProposal(id);
    expect(res).toEqual({ ok: true, data: { taskId: id, start: at(TUE, "15:00").toISOString(), onRequested: true } });
    const t = await loadTask(id);
    expect(t).toMatchObject({ status: "ASSIGNED", assignedById: s.admin.id, decidedById: s.admin.id });
    expect(t.assignees.map((a) => a.userId)).toEqual([s.tl.id]);
    expect(t.scheduledEnd!.getTime()).toBe(at(TUE, "16:00").getTime());
    expect(await jobsOf(id)).toEqual(expect.arrayContaining(["DRIVE_FOLDER", "CALENDAR_EVENT", "CHAT_SPACE"]));
    expect(t.requests.map((r) => r.status)).toEqual(["APPROVED"]);
    const tl = await notesOf(id, s.tl.id);
    expect(tl.map((n) => n.kind)).toEqual(["TASK_PROPOSAL_APPROVED"]);
    expect(tl[0]!.title).toMatch(/^Approved · .* · you can now assign an executive$/);
    expect(await testDb.notification.count({ where: { taskId: id, userId: s.admin.id, kind: "TASK_PROPOSAL_APPROVED" } })).toBe(0);
    // decided once
    expect((await approveProposal(id)).ok).toBe(false);
  });

  it("approve → the next free slot when the requested time is taken (the existing slot finder)", async () => {
    session.set(s.admin);
    const { createTask } = await import("@/server/tasks/create");
    const busy = await createTask({ title: "busy", clientId: s.client.id, teamIds: [s.team.id], tagIds: [workId], allocatedMinutes: 60, scheduledStart: at(TUE, "15:00").toISOString() });
    expect(busy.ok).toBe(true);
    const id = await propose({ scheduledStart: at(TUE, "15:00").toISOString() });
    session.set(s.admin);
    const { approveProposal } = await import("@/server/tasks/proposals");
    const res = await approveProposal(id);
    expect(res.ok && res.data.onRequested).toBe(false);
    const t = await loadTask(id);
    expect(t.scheduledStart!.getTime()).toBe(at(TUE, "10:00").getTime()); // the next free time on the requested day
  });

  it("Edit & approve applies Admin's changes (title, hours, preferred slot) and approves", async () => {
    const id = await propose({ scheduledStart: TUE });
    session.set(s.admin);
    const { approveProposal } = await import("@/server/tasks/proposals");
    const res = await approveProposal(id, { title: "Diwali reel scripts", allocatedMinutes: 120, requestedDate: TUE, requestedTime: "16:30" });
    expect(res.ok).toBe(true);
    const t = await loadTask(id);
    expect(t).toMatchObject({ title: "Diwali reel scripts", allocatedMinutes: 120, status: "ASSIGNED", requestedTime: "16:30" });
    expect(t.scheduledStart!.getTime()).toBe(at(TUE, "16:30").getTime());
    expect(t.scheduledEnd!.getTime()).toBe(at(TUE, "18:30").getTime());
    // a Team Leader cannot approve
    const second = await propose();
    expect((await approveProposal(second)).ok).toBe(false);
  });

  it("Reject needs a note; the TL hears it, the proposal leaves their list and is kept (soft-deleted) for audit", async () => {
    const id = await propose();
    session.set(s.admin);
    const { rejectProposal } = await import("@/server/tasks/proposals");
    expect(await rejectProposal(id, "  ")).toEqual({ ok: false, error: "A note is required" });
    expect((await rejectProposal(id, "Not this week, bundle it with the reels task")).ok).toBe(true);
    const t = await loadTask(id);
    expect(t.deletedAt).not.toBeNull();
    expect(t).toMatchObject({ status: "PENDING_APPROVAL", decisionNote: "Not this week, bundle it with the reels task", decidedById: s.admin.id });
    expect(t.requests.map((r) => [r.status, r.resolutionNote])).toEqual([["REJECTED", "Not this week, bundle it with the reels task"]]);
    expect((await notesOf(id, s.tl.id)).map((n) => [n.kind, n.title])).toEqual([["TASK_PROPOSAL_REJECTED", "Rejected: Not this week, bundle it with the reels task"]]);
    const { listTasks } = await import("@/server/tasks/queries");
    expect((await listTasks({ id: s.tl.id, role: "TEAM_LEADER", teamId: s.team.id, teamLeaderId: null }, { includeCompleted: true })).some((x) => x.id === id)).toBe(false);
    expect(await jobsOf(id)).toEqual([]);
    expect(await testDb.auditLog.count({ where: { entityId: id, action: "task.reject_proposal" } })).toBe(1);
  });

  it("withdraw: only the proposing TL; it is soft-deleted and leaves Admin's inbox", async () => {
    const id = await propose();
    const { withdrawProposal } = await import("@/server/tasks/proposals");
    session.set(s.exec);
    expect((await withdrawProposal(id)).ok).toBe(false);
    session.set(s.tl);
    expect((await withdrawProposal(id)).ok).toBe(true);
    const t = await loadTask(id);
    expect(t.deletedAt).not.toBeNull();
    expect(t.requests.map((r) => r.status)).toEqual(["RESOLVED"]);
    const { requestBadgeCount } = await import("@/server/requests/inbox");
    expect(await requestBadgeCount("ADMIN")).toBe(0);
    expect((await withdrawProposal(id)).ok).toBe(false);
  });

  it("before approval nobody can assign, start, finish, open Drive or upload; the proposal never repeats", async () => {
    const id = await propose({ recurrence: { freq: "DAILY" } });
    const { assignExecutives, ensureTaskDriveFolder, uploadAttachment } = await import("@/server/tasks/manage");
    const { startTask, completeFromMySide } = await import("@/server/tasks/lifecycle");
    const pending = { ok: false, error: "This task is waiting for Admin's approval" };
    session.set(s.tl);
    expect(await assignExecutives(id, [s.exec.id])).toEqual(pending);
    expect(await startTask(id)).toEqual(pending);
    expect(await completeFromMySide(id)).toEqual(pending);
    expect(await ensureTaskDriveFolder(id)).toEqual(pending);
    const fd = new FormData();
    fd.append("taskId", id);
    fd.append("file", new File(["x"], "brief.txt", { type: "text/plain" }));
    expect(await uploadAttachment(fd)).toEqual(pending);
    session.set(s.admin);
    expect(await assignExecutives(id, [s.exec.id])).toEqual(pending);
    const t = await loadTask(id);
    expect(t.assignees).toEqual([]);
    expect(t.recurrenceRuleId).toBeNull();
    const { spawnNextOccurrence } = await import("@/server/tasks/recurring");
    expect(await spawnNextOccurrence(id, null)).toBeNull();
    // the repeat picked on the proposal is created on approval
    const { approveProposal } = await import("@/server/tasks/proposals");
    expect((await approveProposal(id)).ok).toBe(true);
    expect((await loadTask(id)).recurrenceRule?.repeatFreq).toBe("DAILY");
  });

  it("Executives cannot create work tasks but still book meetings", async () => {
    session.set(s.exec);
    const { createTask } = await import("@/server/tasks/create");
    const work = await createTask({ title: "mine", clientId: s.client.id, assigneeIds: [s.exec.id], tagIds: [workId] });
    expect(work).toEqual({ ok: false, error: "Executives book meetings only — ask your Team Leader for a task" });
    const meeting = await createTask({ type: "MEETING", title: "sync", clientId: s.client.id, assigneeIds: [s.tl.id], scheduledStart: at(TUE, "11:00").toISOString(), allocatedMinutes: 30 });
    expect(meeting.ok).toBe(true);
    expect(await testDb.task.count({ where: { type: "WORK" } })).toBe(0);
  });

  it("the Requests inbox and the header badge count proposals (one shared count)", async () => {
    const { requestBadgeCount, requestInbox } = await import("@/server/requests/inbox");
    const { inboxCounts, inboxTotal } = await import("@/server/requests/areas");
    const id = await propose({ scheduledStart: at(TUE, "15:00").toISOString() });
    await propose({ title: "Second" });
    const inbox = await requestInbox();
    const row = inbox.work.find((r) => r.task?.id === id);
    expect(row).toMatchObject({ type: "TASK_PROPOSAL", status: "OPEN", raisedBy: { id: s.tl.id } });
    expect(row?.task?.proposal).toEqual({ minutes: 60, deadlineOnly: false, requestedDate: TUE, requestedTime: "15:00", team: "Graphic" });
    expect(inboxCounts(inbox).WORK).toBe(2);
    expect(await requestBadgeCount("ADMIN")).toBe(inboxTotal(inboxCounts(inbox)));
    expect(await requestBadgeCount("ADMIN")).toBe(2);
    session.set(s.admin);
    const { approveProposal } = await import("@/server/tasks/proposals");
    await approveProposal(id);
    expect(await requestBadgeCount("ADMIN")).toBe(1);
    // the generic resolve cannot bypass the decision
    const { resolveRequest } = await import("@/server/requests/actions");
    const open = (await requestInbox()).work[0]!;
    expect((await resolveRequest(open.id, "REJECTED")).ok).toBe(false);
  });

  it("the client's tracking link (/c/<token>) never shows a proposal", async () => {
    await propose({ title: "Secret proposal" });
    const { ensurePortalToken, portalData } = await import("@/server/portal/portal");
    const data = await portalData(await ensurePortalToken(s.client.id));
    expect(JSON.stringify(data)).not.toContain("Secret proposal");
  });
});
