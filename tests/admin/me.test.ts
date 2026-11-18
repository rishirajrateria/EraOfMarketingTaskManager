import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();

describe("/me actions", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("lets any signed-in user toggle email notifications for themselves only", async () => {
    const { exec } = await seedBasics();
    session.set(exec);
    const { setNotifyByEmail } = await import("@/server/admin/me-actions");
    const res = await setNotifyByEmail(true);
    expect(res.ok).toBe(true);
    expect((await testDb.user.findUniqueOrThrow({ where: { id: exec.id } })).notifyByEmail).toBe(true);
    session.clear();
    expect((await setNotifyByEmail(false)).ok).toBe(false);
  });
});
