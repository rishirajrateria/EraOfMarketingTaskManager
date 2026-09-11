import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";
import { addDays } from "date-fns";

const session = mockSession();

describe("add-task header inventory", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns remaining hours and assigned task counts for the visible team, narrowing to selected assignees", async () => {
    const { admin, tl, exec, client } = await seedBasics();
    // one task tomorrow for the exec (2h)
    const start = addDays(new Date(), 1);
    start.setUTCHours(5, 0, 0, 0); // 10:30 IST
    await testDb.task.create({
      data: { title: "t", clientId: client.id, createdById: tl.id, allocatedMinutes: 120, scheduledStart: start, scheduledEnd: new Date(start.getTime() + 7200_000), assignees: { create: [{ userId: exec.id }] } },
    });
    const { addTaskInventory } = await import("@/server/tasks/create");

    session.set(admin);
    const all = await addTaskInventory([]);
    expect(all.ok).toBe(true);
    if (!all.ok) return;
    expect(all.data.tomorrow.count).toBe(1);
    expect(all.data.month.minutes).toBeGreaterThan(0);

    session.set(tl);
    const mine = await addTaskInventory([exec.id]);
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.data.tomorrow.count).toBe(1);
    // whole-team scope for the TL (self + exec) has at least as much inventory as the exec alone
    const team = await addTaskInventory([]);
    expect(team.ok && team.data.month.minutes >= mine.data.month.minutes).toBe(true);

    session.set(exec);
    expect((await addTaskInventory([tl.id])).ok).toBe(false); // may not look at people they cannot assign
  });
});
