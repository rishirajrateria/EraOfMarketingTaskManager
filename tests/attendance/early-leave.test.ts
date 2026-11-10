/**
 * ADR 0022 — going home early. Time is frozen on Tuesday 10 Nov 2026 in Asia/Kolkata (working days Mon–Sat,
 * 10:00–19:00, lunch 13:30–14:30, 480 productive minutes).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { settle } from "../tasks/helpers";
import { dateKey, parseDateKey, zonedDayAt } from "@/lib/time";
import { fromDbDate } from "@/server/inventory/compute";
import type { Role } from "@prisma/client";

const session = mockSession();
const TZ = "Asia/Kolkata";
const TUE = "2026-11-10";
const WED = "2026-11-11";
const THU = "2026-11-12";
const FRI = "2026-11-13";
const at = (key: string, hhmm: string) => zonedDayAt(parseDateKey(key, TZ), Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
let seed: Awaited<ReturnType<typeof seedBasics>>;

async function task(title: string, key: string, from: string, to: string, extra: Record<string, unknown> = {}) {
  return testDb.task.create({
    data: {
      title,
      clientId: seed.client.id,
      createdById: seed.admin.id,
      assignedById: seed.admin.id,
      allocatedMinutes: Math.round((at(key, to).getTime() - at(key, from).getTime()) / 60_000),
      scheduledStart: at(key, from),
      scheduledEnd: at(key, to),
      assignees: { create: [{ userId: seed.exec.id }] },
      ...extra,
    },
  });
}

async function mark(as: { id: string; role: Role }, input: { leftAt: string; mode: "UNTIL" | "ASK"; until?: string; reason?: "SICK" | "PERSONAL" | "OTHER" }) {
  session.set(as);
  const { markGoingHomeEarly } = await import("@/server/early-leave/actions");
  return markGoingHomeEarly({ userId: seed.exec.id, reason: input.reason ?? "SICK", leftAt: input.leftAt, mode: input.mode, until: input.until ?? null });
}

async function markOk(input: Parameters<typeof mark>[1], as: { id: string; role: Role } = seed.hr) {
  const r = await mark(as, input);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

async function dayOf(userId: string, key: string) {
  const { loadAvailability, loadPeople } = await import("@/server/availability/load");
  const { workingConfig } = await import("@/server/scheduling/slot");
  return (await loadAvailability(await loadPeople([userId]), key, key, await workingConfig())).day(userId, key);
}

async function inventoryRow(userId: string, key: string) {
  const { inventoryFor } = await import("@/server/inventory/queries");
  return (await inventoryFor({ from: parseDateKey(key, TZ), to: parseDateKey(key, TZ) }, { userId })).rows[0];
}

const minutesByDay = (chunks: { start: Date; end: Date }[]) => {
  const out: Record<string, number> = {};
  for (const c of chunks) out[dateKey(c.start, TZ)] = (out[dateKey(c.start, TZ)] ?? 0) + Math.round((c.end.getTime() - c.start.getTime()) / 60_000);
  return out;
};

describe("going home early (ADR 0022)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(TUE, "15:30"));
    await resetDb();
    seed = await seedBasics();
    (await import("@/lib/settings")).invalidateSettingsCache();
  });
  afterEach(async () => {
    await settle(100);
    vi.useRealTimers();
  });

  it("marks with UNTIL: covers today from leftAt through the last day; Admins hear about it, not the HR who marked it", async () => {
    await task("Banner", TUE, "16:00", "17:00");
    const r = await markOk({ leftAt: "15:00", mode: "UNTIL", until: WED });
    expect(r.flagged).toBe(1);
    const row = await testDb.earlyLeave.findUniqueOrThrow({ where: { id: r.id } });
    expect([fromDbDate(row.day), fromDbDate(row.coveredThrough), row.until && fromDbDate(row.until), row.mode, row.reason, row.active]).toEqual([TUE, WED, WED, "UNTIL", "SICK", true]);
    expect(row.leftAt.getTime()).toBe(at(TUE, "15:00").getTime());
    const notes = await testDb.notification.findMany({ where: { kind: "EARLY_LEAVE" } });
    expect(notes.map((n) => [n.userId, n.title])).toEqual([[seed.admin.id, "Arush left early · 1 task needs shifting"]]);
    expect(notes[0].body).toBe("3:00pm · Sick · away until 11 Nov");
  });

  it("marks with ASK: covers the rest of today only; HR's copy says Admin will shift", async () => {
    await task("Banner", TUE, "16:00", "17:00");
    const r = await markOk({ leftAt: "15:00", mode: "ASK", reason: "PERSONAL" }, seed.admin);
    const row = await testDb.earlyLeave.findUniqueOrThrow({ where: { id: r.id } });
    expect([fromDbDate(row.coveredThrough), row.until, row.mode]).toEqual([TUE, null, "ASK"]);
    const notes = await testDb.notification.findMany({ where: { kind: "EARLY_LEAVE" } });
    expect(notes.map((n) => [n.userId, n.body])).toEqual([[seed.hr.id, "3:00pm · Personal · asking again tomorrow morning · Admin will shift these"]]);
    expect((await dayOf(seed.exec.id, WED)).kind).toBe("WORKING");
  });

  it("availability: the window ends at leftAt, later days are AWAY; inventory, the add-task header, the HR tile and attendance agree", async () => {
    await markOk({ leftAt: "15:00", mode: "UNTIL", until: WED });
    const tue = await dayOf(seed.exec.id, TUE);
    expect(tue).toMatchObject({ kind: "WORKING", capacityMinutes: 240 }); // 10:00–13:30 + 14:30–15:00
    expect(tue.window[tue.window.length - 1].end.getTime()).toBe(at(TUE, "15:00").getTime());
    expect(await dayOf(seed.exec.id, WED)).toMatchObject({ kind: "AWAY", capacityMinutes: 0, window: [] });
    expect(await inventoryRow(seed.exec.id, TUE)).toMatchObject({ capacityMinutes: 240 });
    expect(await inventoryRow(seed.exec.id, WED)).toMatchObject({ kind: "AWAY", capacityMinutes: 0 });

    session.set(seed.tl);
    const { addTaskInventory } = await import("@/server/tasks/create");
    const header = await addTaskInventory([seed.team.id]);
    if (!header.ok) throw new Error(header.error);
    expect(header.data.today).toMatchObject({ leftMinutes: 480 + 240 });
    expect(header.data.tomorrow).toMatchObject({ leftMinutes: 480 });

    const { hrDashboard } = await import("@/server/dashboards/hr");
    const hr = await hrDashboard({ team: null, period: "MONTH" });
    expect(hr.people.find((p) => p.userId === seed.exec.id)?.early?.label).toBe("Left early 3:00pm · Sick");

    const { attendanceMonth } = await import("@/server/attendance/queries");
    const grid = await attendanceMonth({ id: seed.hr.id, role: "HR", teamId: null, teamLeaderId: null }, { month: "2026-11" });
    expect(grid.cells[seed.exec.id][TUE]).toMatchObject({ status: "PRESENT", away: "Left early 3:00pm · Sick" });
    expect(grid.cells[seed.exec.id][WED]).toMatchObject({ status: "ABSENT", away: "Away · Sick" });
    expect(grid.cells[seed.exec.id][THU]).toBeUndefined();
  });

  it("the slot finder agrees: nothing after leftAt, nothing on AWAY days", async () => {
    await markOk({ leftAt: "15:00", mode: "UNTIL", until: WED });
    const { proposeSlot } = await import("@/server/scheduling/slot");
    const p = await proposeSlot([seed.exec.id], 300, { requesterRole: "TEAM_LEADER", requesterId: seed.tl.id });
    expect(p!.start.getTime()).toBe(at(THU, "10:00").getTime());
    expect(minutesByDay(p!.chunks)).toEqual({ [THU]: 300 });

    vi.setSystemTime(at(TUE, "11:00"));
    await testDb.earlyLeave.deleteMany();
    await markOk({ leftAt: "12:00", mode: "ASK" });
    const q = await proposeSlot([seed.exec.id], 120, { requesterRole: "TEAM_LEADER", requesterId: seed.tl.id });
    expect(minutesByDay(q!.chunks)).toEqual({ [TUE]: 60, [WED]: 60 });
    expect(q!.chunks[0].end.getTime()).toBe(at(TUE, "12:00").getTime());
    expect(await inventoryRow(seed.exec.id, TUE)).toMatchObject({ capacityMinutes: 120 });
  });

  it("flags the tasks in the covered period only (before leftAt, completed and later ones are not)", async () => {
    await task("Morning", TUE, "11:00", "12:00");
    const over = await task("Over", TUE, "14:30", "15:30");
    const late = await task("Late", TUE, "16:00", "17:00");
    const wed = await task("Wed", WED, "10:00", "11:00");
    await task("Done", TUE, "17:00", "18:00", { status: "COMPLETED" });
    await task("Thu", THU, "10:00", "11:00");
    session.set(seed.hr);
    const { previewEarlyLeave } = await import("@/server/early-leave/actions");
    const preview = await previewEarlyLeave({ userId: seed.exec.id, leftAt: "15:00", reason: "SICK", mode: "UNTIL", until: WED });
    expect(preview.ok && preview.data.flagged).toBe(3);
    await markOk({ leftAt: "15:00", mode: "UNTIL", until: WED });
    const { earlyBanners } = await import("@/server/early-leave/queries");
    const [banner] = await earlyBanners();
    expect(new Set(banner.taskIds)).toEqual(new Set([over.id, late.id, wed.id]));
    expect(banner.detail).toBe("3:00pm · Sick · away until 11 Nov");

    // moved outside the period (by the edit sheet) or reassigned → no longer flagged
    await testDb.task.update({ where: { id: late.id }, data: { scheduledStart: at(THU, "12:00"), scheduledEnd: at(THU, "13:00") } });
    await testDb.taskAssignee.updateMany({ where: { taskId: wed.id }, data: { userId: seed.tl.id } });
    expect((await earlyBanners())[0].taskIds).toEqual([over.id]);
  });

  it("shift all moves movable tasks after the period, skips started, paused, finish-requested, meetings and protected", async () => {
    const a = await task("A", TUE, "16:00", "17:00");
    const b = await task("B", WED, "10:00", "11:00");
    const fixed = [
      await task("Started", TUE, "17:00", "18:00", { status: "STARTED" }),
      await task("Paused", WED, "11:00", "12:00", { status: "PAUSED" }),
      await task("Finish", WED, "12:00", "13:00", { status: "FINISH_REQUESTED" }),
      await task("Meet", WED, "15:00", "16:00", { type: "MEETING" }),
      await task("Fixed", WED, "16:00", "17:00", { protected: true }),
    ];
    const { id } = await markOk({ leftAt: "15:00", mode: "UNTIL", until: WED });

    session.set(seed.admin);
    const { previewEarlyShift, shiftAllEarlyLeave } = await import("@/server/early-leave/actions");
    const plan = await previewEarlyShift(id);
    if (!plan.ok) throw new Error(plan.error);
    expect(plan.data.map((p) => [p.title, p.to?.start.getTime() ?? null, p.why])).toEqual([
      ["A", at(THU, "10:00").getTime(), null],
      ["Started", null, "started"],
      ["B", at(THU, "11:00").getTime(), null],
      ["Paused", null, "paused"],
      ["Finish", null, "finish-requested"],
      ["Meet", null, "meeting"],
      ["Fixed", null, "protected"],
    ]);
    const before = await testDb.notification.count({ where: { kind: "TASK_SHIFTED" } });
    const r = await shiftAllEarlyLeave(id);
    expect(r.ok && [r.data.shifted, r.data.manual.length]).toEqual([2, 5]);
    expect((await testDb.task.findUniqueOrThrow({ where: { id: a.id } })).scheduledStart!.getTime()).toBe(at(THU, "10:00").getTime());
    expect((await testDb.task.findUniqueOrThrow({ where: { id: b.id } })).scheduledEnd!.getTime()).toBe(at(THU, "12:00").getTime());
    for (const t of fixed) expect((await testDb.task.findUniqueOrThrow({ where: { id: t.id } })).scheduledStart!.getTime()).toBe(t.scheduledStart!.getTime());

    // TASK_SHIFTED to the assignee and their Team Leader, never to the Admin who shifted
    const shifted = await testDb.notification.findMany({ where: { kind: "TASK_SHIFTED" }, orderBy: { createdAt: "asc" } });
    expect(shifted.length - before).toBe(4);
    expect(new Set(shifted.map((n) => n.userId))).toEqual(new Set([seed.exec.id, seed.tl.id]));
    expect(shifted[0].body).toBe("Arush is away · moved after the time off");
    const { earlyBanners } = await import("@/server/early-leave/queries");
    expect((await earlyBanners())[0].taskIds).toHaveLength(5); // the "Move yourself" ones stay flagged
  });

  it("the morning ask: Still off covers that day and asks again; Back ends it", async () => {
    await task("Wed work", WED, "11:00", "12:00");
    const { id } = await markOk({ leftAt: "15:00", mode: "ASK" });
    const { askWhoIsBack } = await import("@/server/early-leave/service");
    const { run } = await import("@/jobs/back-question");
    expect(await run(at(TUE, "16:00"))).toEqual({ asked: 0 }); // today still covered
    expect(await run(at(WED, "07:30"))).toEqual({ asked: 0 }); // before the morning (2h before 10:00)
    vi.setSystemTime(at(WED, "08:30"));
    expect(await askWhoIsBack(at(WED, "08:30"))).toEqual({ asked: 1 });
    expect(await askWhoIsBack(at(WED, "09:00"))).toEqual({ asked: 0 }); // once per morning
    const asks = await testDb.notification.findMany({ where: { kind: "BACK_QUESTION" } });
    expect(asks.map((n) => [n.userId, n.title, n.href])).toEqual(
      expect.arrayContaining([
        [seed.admin.id, "Is Arush back today?", `/admin/requests?ask=${id}`],
        [seed.hr.id, "Is Arush back today?", `/attendance?ask=${id}`],
      ]),
    );
    const { backQuestions } = await import("@/server/early-leave/queries");
    expect((await backQuestions()).map((q) => q.text)).toEqual(["Left early 10 Nov 3:00pm · Sick"]);
    expect((await dayOf(seed.exec.id, WED)).kind).toBe("WORKING"); // not covered until answered

    session.set(seed.hr);
    const { answerBackToday } = await import("@/server/early-leave/actions");
    const off = await answerBackToday(id, false);
    expect(off.ok && off.data.flagged).toBe(1);
    expect((await dayOf(seed.exec.id, WED)).kind).toBe("AWAY");
    expect(await testDb.notification.count({ where: { kind: "BACK_QUESTION", readAt: null } })).toBe(0);
    const still = await testDb.notification.findFirstOrThrow({ where: { kind: "EARLY_LEAVE", title: { startsWith: "Arush still off" } } });
    expect([still.userId, still.title]).toEqual([seed.admin.id, "Arush still off · 1 task needs shifting"]);

    vi.setSystemTime(at(THU, "08:30"));
    expect(await askWhoIsBack(at(THU, "08:30"))).toEqual({ asked: 1 });
    expect((await backQuestions())[0].text).toBe("Left early 10 Nov 3:00pm · Sick · still off 1 more day");
    const back = await answerBackToday(id, true);
    expect(back.ok).toBe(true);
    const row = await testDb.earlyLeave.findUniqueOrThrow({ where: { id } });
    expect([row.backOn && fromDbDate(row.backOn), fromDbDate(row.coveredThrough), row.askDay]).toEqual([THU, WED, null]);
    expect((await dayOf(seed.exec.id, THU)).kind).toBe("WORKING");
    expect(await askWhoIsBack(at(FRI, "09:00"))).toEqual({ asked: 0 });
    expect(await backQuestions()).toEqual([]);
  });

  it("cancel puts everything back", async () => {
    await task("Late", TUE, "16:00", "17:00");
    const { id } = await markOk({ leftAt: "15:00", mode: "UNTIL", until: WED });
    session.set(seed.admin);
    const { cancelGoingHomeEarly } = await import("@/server/early-leave/actions");
    expect((await cancelGoingHomeEarly(id)).ok).toBe(true);
    expect((await testDb.earlyLeave.findUniqueOrThrow({ where: { id } })).active).toBe(false);
    expect(await dayOf(seed.exec.id, TUE)).toMatchObject({ kind: "WORKING", capacityMinutes: 480, away: null });
    expect((await dayOf(seed.exec.id, WED)).kind).toBe("WORKING");
    const { earlyBanners } = await import("@/server/early-leave/queries");
    expect(await earlyBanners()).toEqual([]);
    expect((await cancelGoingHomeEarly(id)).ok).toBe(false);
  });

  it("only Admin and HR can mark; only Admin can shift", async () => {
    for (const who of [seed.tl, seed.exec]) {
      const r = await mark(who, { leftAt: "15:00", mode: "ASK" });
      expect(r.ok).toBe(false);
    }
    const { id } = await markOk({ leftAt: "15:00", mode: "ASK" }, seed.hr);
    const { previewEarlyShift, shiftAllEarlyLeave, cancelGoingHomeEarly } = await import("@/server/early-leave/actions");
    for (const who of [seed.hr, seed.tl, seed.exec]) {
      session.set(who);
      expect((await previewEarlyShift(id)).ok).toBe(false);
      expect((await shiftAllEarlyLeave(id)).ok).toBe(false);
    }
    session.set(seed.tl);
    expect((await cancelGoingHomeEarly(id)).ok).toBe(false);
    session.set(seed.admin);
    expect((await shiftAllEarlyLeave(id)).ok).toBe(true);
    expect(await testDb.earlyLeave.count()).toBe(1);
  });

  it("notifications: People group, targets, filters and a bad last day", async () => {
    const { KIND_META, notificationTarget, kindsOfGroup } = await import("@/lib/notification-kinds");
    expect([KIND_META.EARLY_LEAVE.group, KIND_META.BACK_QUESTION.group]).toEqual(["PEOPLE", "PEOPLE"]);
    expect(kindsOfGroup("PEOPLE")).toEqual(expect.arrayContaining(["EARLY_LEAVE", "BACK_QUESTION"]));
    const n = (kind: "EARLY_LEAVE" | "BACK_QUESTION") => ({ kind, href: null, taskId: null, invoiceId: null });
    expect([notificationTarget(n("EARLY_LEAVE"), "ADMIN"), notificationTarget(n("EARLY_LEAVE"), "HR"), notificationTarget(n("BACK_QUESTION"), "ADMIN"), notificationTarget(n("BACK_QUESTION"), "HR"), notificationTarget(n("EARLY_LEAVE"), "EXECUTIVE")]).toEqual([
      "/dashboard",
      "/attendance",
      "/admin/requests",
      "/attendance",
      null,
    ]);
    const { isUnscopedPeopleKind } = await import("@/lib/notification-scope");
    expect(isUnscopedPeopleKind("BACK_QUESTION")).toBe(true);

    await markOk({ leftAt: "15:00", mode: "ASK" }, seed.admin);
    const { loadFeed } = await import("@/server/notification-feed");
    const feed = await loadFeed({ id: seed.hr.id, role: "HR" }, "PEOPLE", TZ, new Date());
    expect(feed.total).toBe(1);
    expect(feed.groups[0].rows[0]).toMatchObject({ kind: "EARLY_LEAVE", target: "/attendance" });

    const bad = await mark(seed.hr, { leftAt: "15:00", mode: "UNTIL", until: "2026-11-09" });
    expect(bad.ok).toBe(false);
  });
});
