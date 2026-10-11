import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

const session = mockSession();

/** A 2h task tomorrow (company time zone, not UTC — they differ between 18:30 and 24:00 UTC) for `userId`. */
async function taskTomorrow(clientId: string, createdById: string, userId: string, minutes = 120) {
  const tomorrowIst = formatInTimeZone(addDays(new Date(), 1), "Asia/Kolkata", "yyyy-MM-dd");
  const start = fromZonedTime(`${tomorrowIst}T10:30:00`, "Asia/Kolkata");
  return testDb.task.create({
    data: { title: "t", clientId, createdById, allocatedMinutes: minutes, scheduledStart: start, scheduledEnd: new Date(start.getTime() + minutes * 60_000), assignees: { create: [{ userId }] } },
  });
}

describe("add-task header: capacity of the selected team", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns hours left, hours booked and tasks booked per period for the team's members", async () => {
    const { admin, tl, exec, team, client } = await seedBasics();
    await taskTomorrow(client.id, tl.id, exec.id, 120);
    const other = await testDb.team.create({ data: { name: "SEO" } });
    const outsider = await testDb.user.create({ data: { email: "o@test.local", name: "Out Sider", role: "EXECUTIVE", teamId: other.id, activatedAt: new Date() } });
    await taskTomorrow(client.id, admin.id, outsider.id, 60);
    const { addTaskInventory } = await import("@/server/tasks/create");

    session.set(admin);
    const res = await addTaskInventory([team.id]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.tomorrow).toMatchObject({ bookedMinutes: 120, count: 1 });
    expect(res.data.today.bookedMinutes).toBe(0);
    expect(res.data.week.bookedMinutes).toBe(120);
    expect(res.data.month.bookedMinutes).toBe(120);
    expect(res.data.month.leftMinutes).toBeGreaterThan(0);
    // left = capacity − booked: the week with the booking has less left than an otherwise identical team would
    const seo = await addTaskInventory([other.id]);
    expect(seo.ok && seo.data.tomorrow).toMatchObject({ bookedMinutes: 60, count: 1 });
    const both = await addTaskInventory([team.id, other.id]);
    expect(both.ok && both.data.tomorrow).toMatchObject({ bookedMinutes: 180, count: 2 });
  });

  it("needs a team; Team Leaders and Executives only see their own team", async () => {
    const { admin, tl, exec, team } = await seedBasics();
    const other = await testDb.team.create({ data: { name: "SEO" } });
    const { addTaskInventory } = await import("@/server/tasks/create");
    session.set(admin);
    expect((await addTaskInventory([])).ok).toBe(false);
    expect(await addTaskInventory(["nope"])).toEqual({ ok: false, error: "Unknown or inactive team" });
    session.set(tl);
    expect((await addTaskInventory([team.id])).ok).toBe(true);
    expect((await addTaskInventory([other.id])).ok).toBe(false);
    session.set(exec);
    expect((await addTaskInventory([team.id])).ok).toBe(true);
    expect((await addTaskInventory([team.id, other.id])).ok).toBe(false);
  });
});
