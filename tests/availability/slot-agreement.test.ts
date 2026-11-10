/**
 * ADR 0019 — one source of truth for availability: the slot finder ("Up next"), `inventoryFor`, the add-task header
 * and the Day view all read `personDayStatus`. Items 1, 2, 3 and 9 of the availability audit.
 * Time is frozen on Monday 12 Oct 2026, 09:00 in Asia/Kolkata (working days Mon–Sat, 10:00–19:00, lunch 13:30–14:30).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { legacyWorkAs, settle } from "../tasks/helpers";
import { dateKey, parseDateKey, zonedDayAt } from "@/lib/time";
import { toDbDate } from "@/server/inventory/compute";
import type { Interval } from "@/lib/working-time";

const session = mockSession();
const TZ = "Asia/Kolkata";
const MON = "2026-10-12";
const TUE = "2026-10-13";
const WED = "2026-10-14";
const at = (key: string, hhmm: string) => zonedDayAt(parseDateKey(key, TZ), Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), TZ);
let seed: Awaited<ReturnType<typeof seedBasics>>;

/** Minutes of the slot's chunks per company day. */
function minutesByDay(chunks: Interval[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of chunks) out[dateKey(c.start, TZ)] = (out[dateKey(c.start, TZ)] ?? 0) + Math.round((c.end.getTime() - c.start.getTime()) / 60_000);
  return out;
}

async function inventoryRow(userId: string, key: string) {
  const { inventoryFor } = await import("@/server/inventory/queries");
  const inv = await inventoryFor({ from: parseDateKey(key, TZ), to: parseDateKey(key, TZ) }, { userId });
  return inv.rows[0];
}

/** Up next for the Executive, placed for their Team Leader by the real slot finder (a live pre-ADR 0021 work task). */
async function upNext(minutes: number) {
  session.set(seed.tl);
  const id = await legacyWorkAs(seed.tl, seed.client.id, [seed.exec.id], { allocatedMinutes: minutes });
  return testDb.task.findUniqueOrThrow({ where: { id } });
}

describe("availability — slot finder agrees with inventory (ADR 0019)", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(MON, "09:00"));
    await resetDb();
    seed = await seedBasics();
    (await import("@/lib/settings")).invalidateSettingsCache();
  });
  afterEach(async () => {
    await settle(100);
    vi.useRealTimers();
  });

  describe("1. attendance rows", () => {
    it.each(["ABSENT", "LEAVE", "HOLIDAY"] as const)("a %s row makes the day unavailable to Up next and to inventory", async (status) => {
      await testDb.attendance.create({ data: { userId: seed.exec.id, date: toDbDate(MON), status } });
      const t = await upNext(60);
      expect(dateKey(t.scheduledStart!, TZ)).toBe(TUE);
      expect(t.scheduledStart!.getTime()).toBe(at(TUE, "10:00").getTime());
      expect(await inventoryRow(seed.exec.id, MON)).toMatchObject({ capacityMinutes: 0, assignedMinutes: 0 });
    });

    it("a HALF_DAY gets at most capacity/2 placed; the slot finder, inventoryFor and the add-task header agree", async () => {
      await testDb.attendance.create({ data: { userId: seed.exec.id, date: toDbDate(MON), status: "HALF_DAY" } });
      const { proposeSlot } = await import("@/server/scheduling/slot");
      const proposal = await proposeSlot([seed.exec.id], 360, { requesterRole: "TEAM_LEADER", requesterId: seed.tl.id });
      const perDay = minutesByDay(proposal!.chunks);
      expect(perDay).toEqual({ [MON]: 240, [TUE]: 120 });
      // the half day's window is the first half of the working day: 10:00–13:30 and 14:30–15:00
      expect(proposal!.chunks[0].start.getTime()).toBe(at(MON, "10:00").getTime());
      expect(proposal!.chunks[1].end.getTime()).toBe(at(MON, "15:00").getTime());

      const t = await upNext(360);
      expect(t.scheduledStart!.getTime()).toBe(proposal!.start.getTime());
      expect(t.scheduledEnd!.getTime()).toBe(proposal!.end.getTime());
      const mon = await inventoryRow(seed.exec.id, MON);
      expect(mon).toMatchObject({ kind: "HALF", capacityMinutes: 240, assignedMinutes: 240, sellableMinutes: 0, overbookedMinutes: 0 });
      expect(await inventoryRow(seed.exec.id, TUE)).toMatchObject({ capacityMinutes: 480, assignedMinutes: 120 });

      session.set(seed.tl);
      const { addTaskInventory } = await import("@/server/tasks/create");
      const header = await addTaskInventory([seed.team.id]);
      if (!header.ok) throw new Error(header.error);
      // team = Team Leader (480 free) + Executive (half day, fully booked)
      expect(header.data.today).toMatchObject({ bookedMinutes: 240, leftMinutes: 480, count: 1 });
      expect(header.data.tomorrow).toMatchObject({ bookedMinutes: 120, leftMinutes: 480 + 360 });
    });

    it("a HALF_DAY with check-in / check-out only offers that window", async () => {
      await testDb.attendance.create({ data: { userId: seed.exec.id, date: toDbDate(MON), status: "HALF_DAY", checkIn: at(MON, "14:30"), checkOut: at(MON, "19:00") } });
      const { proposeSlot } = await import("@/server/scheduling/slot");
      const p = await proposeSlot([seed.exec.id], 300, { requesterRole: "TEAM_LEADER", requesterId: seed.tl.id });
      expect(p!.start.getTime()).toBe(at(MON, "14:30").getTime());
      expect(minutesByDay(p!.chunks)).toEqual({ [MON]: 240, [TUE]: 60 });
      const { hourlyBreakdown } = await import("@/server/inventory/queries");
      const h = await hourlyBreakdown(parseDateKey(MON, TZ), { userId: seed.exec.id });
      expect(h.rows[0].status).toBe("HALF_DAY");
      expect(h.rows[0].cells.filter((c) => c.kind === "off").map((c) => c.start)).toEqual([600, 660, 720, 780]); // 10:00–14:00 off
    });
  });

  describe("2. per-user overrides", () => {
    it("never books a person's own non-working day; the Day view shows it as OFF", async () => {
      await testDb.user.update({ where: { id: seed.exec.id }, data: { workingDays: [2, 3, 4, 5, 6] } }); // Mondays off
      const t = await upNext(60);
      expect(dateKey(t.scheduledStart!, TZ)).toBe(TUE);
      expect(await inventoryRow(seed.exec.id, MON)).toMatchObject({ kind: "OFF_WEEKLY", capacityMinutes: 0 });
      const { hourlyBreakdown } = await import("@/server/inventory/queries");
      const h = await hourlyBreakdown(parseDateKey(MON, TZ), { userId: seed.exec.id });
      expect(h.rows[0].status).toBe("OFF");
      expect(h.rows[0].cells.every((c) => c.kind === "off")).toBe(true);
    });

    it("books no more than dailyCapacityMinutes per day", async () => {
      await testDb.user.update({ where: { id: seed.exec.id }, data: { dailyCapacityMinutes: 120 } });
      const t = await upNext(300);
      expect(dateKey(t.scheduledStart!, TZ)).toBe(MON);
      expect(dateKey(t.scheduledEnd!, TZ)).toBe(WED);
      for (const [key, booked] of [[MON, 120], [TUE, 120], [WED, 60]] as const) {
        expect(await inventoryRow(seed.exec.id, key)).toMatchObject({ capacityMinutes: 120, assignedMinutes: booked, overbookedMinutes: 0 });
      }
      // a second task cannot squeeze into Monday's or Tuesday's leftover window
      const { proposeSlot } = await import("@/server/scheduling/slot");
      const next = await proposeSlot([seed.exec.id], 60, { requesterRole: "TEAM_LEADER", requesterId: seed.tl.id });
      expect(dateKey(next!.start, TZ)).toBe(WED);
    });

    it("exposes overbooking instead of clamping silently", async () => {
      await testDb.task.create({
        data: {
          title: "Manual",
          clientId: seed.client.id,
          createdById: seed.tl.id,
          assignedById: seed.tl.id,
          allocatedMinutes: 600,
          scheduledStart: at(MON, "10:00"),
          scheduledEnd: at(MON, "19:00"),
          assignees: { create: [{ userId: seed.exec.id }] },
        },
      });
      const { inventoryFor } = await import("@/server/inventory/queries");
      const inv = await inventoryFor({ from: parseDateKey(MON, TZ), to: parseDateKey(TUE, TZ) }, { userId: seed.exec.id });
      expect(inv.rows.find((r) => r.date === MON)).toMatchObject({ capacityMinutes: 480, assignedMinutes: 600, sellableMinutes: 0, overbookedMinutes: 120 });
      // totals keep the free Tuesday AND the overbooked Monday
      expect(inv.total).toMatchObject({ sellableMinutes: 480, overbookedMinutes: 120 });
    });
  });

  describe("3. multi-day tasks", () => {
    it("spread their minutes over the working days they occupy, matching the slot finder's chunks", async () => {
      const { proposeSlot } = await import("@/server/scheduling/slot");
      const p = await proposeSlot([seed.exec.id], 600, { requesterRole: "TEAM_LEADER", requesterId: seed.tl.id });
      expect(minutesByDay(p!.chunks)).toEqual({ [MON]: 480, [TUE]: 120 });
      await upNext(600);
      expect((await inventoryRow(seed.exec.id, MON)).assignedMinutes).toBe(480);
      expect((await inventoryRow(seed.exec.id, TUE)).assignedMinutes).toBe(120);
      session.set(seed.tl);
      const { addTaskInventory } = await import("@/server/tasks/create");
      const header = await addTaskInventory([seed.team.id]);
      expect(header.ok && header.data.today.bookedMinutes).toBe(480);
      expect(header.ok && header.data.tomorrow.bookedMinutes).toBe(120);
    });

    it("skip a leave day inside the span (it books nothing there)", async () => {
      await testDb.task.create({
        data: {
          title: "Span",
          clientId: seed.client.id,
          createdById: seed.tl.id,
          assignedById: seed.tl.id,
          allocatedMinutes: 960,
          scheduledStart: at(MON, "10:00"),
          scheduledEnd: at(WED, "19:00"),
          assignees: { create: [{ userId: seed.exec.id }] },
        },
      });
      await testDb.leave.create({ data: { userId: seed.exec.id, from: toDbDate(TUE), to: toDbDate(TUE), status: "ADMIN_APPROVED" } });
      const { inventoryFor } = await import("@/server/inventory/queries");
      const inv = await inventoryFor({ from: parseDateKey(MON, TZ), to: parseDateKey(WED, TZ) }, { userId: seed.exec.id });
      expect(inv.rows.map((r) => [r.date, r.assignedMinutes])).toEqual([[MON, 480], [TUE, 0], [WED, 480]]);
    });
  });

  describe("9. meetings", () => {
    it("are busy time for the slot finder and the Day view, but book no hours", async () => {
      await testDb.task.create({
        data: {
          title: "Kick-off",
          type: "MEETING",
          clientId: seed.client.id,
          createdById: seed.tl.id,
          assignedById: seed.tl.id,
          allocatedMinutes: 120,
          scheduledStart: at(MON, "10:00"),
          scheduledEnd: at(MON, "12:00"),
          assignees: { create: [{ userId: seed.exec.id }] },
        },
      });
      expect((await inventoryRow(seed.exec.id, MON)).assignedMinutes).toBe(0);
      const t = await upNext(60);
      expect(t.scheduledStart!.getTime()).toBe(at(MON, "12:00").getTime());
      const { hourlyBreakdown } = await import("@/server/inventory/queries");
      const h = await hourlyBreakdown(parseDateKey(MON, TZ), { userId: seed.exec.id });
      expect(h.rows[0].cells.slice(0, 3).map((c) => c.kind)).toEqual(["assigned", "assigned", "assigned"]);
    });
  });
});
