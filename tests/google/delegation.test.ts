import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, seedBasics, testDb } from "../helpers/db";
import { env } from "@/lib/env";

/**
 * ADR 0018: if the admin's domain is a separate Google Workspace, domain-wide delegation can't impersonate them.
 * Per-user calls (leave sync's Calendar read) skip that user; Chat spaces are created without them instead of failing.
 */
const fake = vi.hoisted(() => ({
  /** Emails delegation refuses (token endpoint says unauthorized_client). */
  outside: new Set<string>(),
  events: [] as { id: string; summary: string; status: string; eventType: string; start: { date: string }; end: { date: string } }[],
  calendarCalls: [] as string[],
  setups: [] as string[][],
  added: [] as string[],
}));

const delegationError = () =>
  Object.assign(new Error("unauthorized_client: Client is unauthorized to retrieve access tokens using this method"), {
    response: { status: 401, data: { error: "unauthorized_client" } },
  });
const apiError = (code: number, message: string) => Object.assign(new Error(message), { code });

vi.mock("@/google/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/google/client")>();
  return {
    ...real,
    withRetry: <T,>(fn: () => Promise<T>) => real.withRetry(fn, 4, 1),
    calendarAs: (email: string) => ({
      events: {
        list: async () => {
          fake.calendarCalls.push(email);
          if (fake.outside.has(email)) throw delegationError();
          return { data: { items: fake.events } };
        },
      },
    }),
    chat: () => ({
      spaces: {
        setup: async ({ requestBody }: { requestBody: { memberships: { member: { name: string } }[] } }) => {
          const members = requestBody.memberships.map((m) => m.member.name.replace("users/", ""));
          fake.setups.push(members);
          if (members.some((m) => fake.outside.has(m))) throw apiError(400, "External users are not allowed in this space");
          return { data: { name: "spaces/abc" } };
        },
        members: {
          create: async ({ requestBody }: { requestBody: { member: { name: string } } }) => {
            const email = requestBody.member.name.replace("users/", "");
            if (fake.outside.has(email)) throw apiError(403, "Permission denied for external user");
            fake.added.push(email);
            return { data: {} };
          },
        },
      },
    }),
  };
});

const saved = { googleMock: env.googleMock, impersonateUser: env.impersonateUser };

describe("out-of-Workspace users degrade gracefully (ADR 0018)", () => {
  beforeEach(async () => {
    const { resetUndelegable } = await import("@/google/client");
    resetUndelegable();
    fake.outside.clear();
    fake.events = [];
    fake.calendarCalls.length = 0;
    fake.setups.length = 0;
    fake.added.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    Object.assign(env, saved);
    vi.restoreAllMocks();
  });

  it("isDelegationError recognises token refusals, not ordinary API errors", async () => {
    const { isDelegationError } = await import("@/google/client");
    expect(isDelegationError(delegationError())).toBe(true);
    expect(isDelegationError({ response: { data: { error: "invalid_grant", error_description: "Invalid email or User ID" } } })).toBe(true);
    expect(isDelegationError(new Error("invalid_grant: Invalid email or User ID"))).toBe(true);
    expect(isDelegationError(apiError(403, "The caller does not have permission"))).toBe(false);
    expect(isDelegationError(apiError(500, "Backend error"))).toBe(false);
    expect(isDelegationError(null)).toBe(false);
  });

  it("asWorkspaceUser returns the fallback (and remembers the user) on a delegation refusal; other errors still throw", async () => {
    const { asWorkspaceUser } = await import("@/google/client");
    const fn = vi.fn(async () => {
      throw delegationError();
    });
    expect(await asWorkspaceUser("contact@eraofmarketing.com", "skipped", fn)).toBe("skipped");
    expect(await asWorkspaceUser("Contact@EraOfMarketing.com", "skipped", fn)).toBe("skipped");
    expect(fn).toHaveBeenCalledTimes(1); // not retried, not re-attempted this process
    expect(console.warn).toHaveBeenCalledTimes(1);
    await expect(asWorkspaceUser("asha@theeraofmarketing.com", "x", async () => Promise.reject(apiError(500, "boom")))).rejects.toThrow("boom");
  });

  it("listLeaveEvents skips an admin outside the delegated Workspace instead of throwing", async () => {
    env.googleMock = false;
    fake.outside.add("contact@eraofmarketing.com");
    const { listLeaveEvents } = await import("@/google/calendar");
    const from = new Date("2026-10-01T00:00:00Z");
    const to = new Date("2026-11-01T00:00:00Z");
    expect(await listLeaveEvents("contact@eraofmarketing.com", from, to)).toEqual([]);
    fake.events = [{ id: "e1", summary: "Leave", status: "confirmed", eventType: "outOfOffice", start: { date: "2026-10-12" }, end: { date: "2026-10-13" } }];
    expect(await listLeaveEvents("asha@theeraofmarketing.com", from, to)).toEqual([{ id: "e1", summary: "Leave", start: "2026-10-12", end: "2026-10-13", allDay: true }]);
  });

  it("leave sync: the out-of-Workspace admin is skipped, everyone else is still imported, no errors", async () => {
    await resetDb();
    const { admin, exec } = await seedBasics();
    await testDb.user.update({ where: { id: admin.id }, data: { email: "contact@eraofmarketing.com" } });
    env.googleMock = false;
    fake.outside.add("contact@eraofmarketing.com");
    fake.events = [{ id: "e1", summary: "Leave", status: "confirmed", eventType: "outOfOffice", start: { date: "2026-10-12" }, end: { date: "2026-10-13" } }];
    const { run } = await import("@/jobs/leave-sync");
    const r = await run(new Date("2026-10-10T00:00:00Z"));
    env.googleMock = true;
    expect(r.errors).toBe(0);
    expect(fake.calendarCalls).toContain("contact@eraofmarketing.com");
    expect(await testDb.leave.count({ where: { userId: admin.id } })).toBe(0);
    expect(await testDb.leave.count({ where: { userId: exec.id } })).toBe(1);
  });

  it("Chat space setup refused for an external member → space created with the organiser's domain, others added best-effort", async () => {
    env.googleMock = false;
    env.impersonateUser = "ops@theeraofmarketing.com";
    fake.outside.add("contact@eraofmarketing.com");
    const { createSpace, addMembers } = await import("@/google/chat");
    const space = await createSpace("Task: Reel", ["asha@theeraofmarketing.com", "contact@eraofmarketing.com"], "task-1");
    expect(space.name).toBe("spaces/abc");
    expect(fake.setups).toEqual([["asha@theeraofmarketing.com", "contact@eraofmarketing.com"], ["asha@theeraofmarketing.com"]]);
    await expect(addMembers("spaces/abc", ["contact@eraofmarketing.com", "ravi@theeraofmarketing.com"])).resolves.toBeUndefined();
    expect(fake.added).toEqual(["ravi@theeraofmarketing.com"]);
  });
});
