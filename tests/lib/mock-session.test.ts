import { describe, it, expect } from "vitest";
import { mockSession } from "../helpers/mock-session";

const session = mockSession();

describe("mockSession helper", () => {
  it("drives requireUser()", async () => {
    const { requireUser, currentUser } = await import("@/lib/rbac");
    expect(await currentUser()).toBeNull();
    session.set({ id: "u1", role: "ADMIN" });
    expect((await requireUser()).id).toBe("u1");
  });
});
