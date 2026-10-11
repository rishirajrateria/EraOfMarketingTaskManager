import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { addDays } from "date-fns";

describe("protected tasks", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("are never shifted by shiftTaskToNextSlot", async () => {
    const { admin, client } = await seedBasics();
    const start = addDays(new Date(), 3);
    const t = await testDb.task.create({
      data: {
        title: "Admin block", clientId: client.id, createdById: admin.id, allocatedMinutes: 60,
        scheduledStart: start, scheduledEnd: new Date(start.getTime() + 3600_000), selfAssigned: true, protected: true,
        assignees: { create: [{ userId: admin.id }] },
      },
    });
    const { shiftTaskToNextSlot } = await import("@/server/scheduling/slot");
    expect(await shiftTaskToNextSlot(t.id, admin.id, "test")).toBeNull();
    const after = await testDb.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.scheduledStart?.getTime()).toBe(start.getTime());
  });
});
