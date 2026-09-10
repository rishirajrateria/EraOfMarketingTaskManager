import { vi } from "vitest";
import type { SessionUser } from "@/lib/rbac";

/**
 * Mocks `@/lib/auth` so `requireUser()` resolves to the given user. Call before importing actions.
 * Usage:  const s = mockSession(); s.set(user);
 */
export function mockSession() {
  let current: SessionUser | null = null;
  vi.mock("@/lib/auth", () => ({
    auth: async () => (current ? { user: current } : null),
    signIn: vi.fn(),
    signOut: vi.fn(),
    handlers: {},
  }));
  return {
    set(u: { id: string; role: SessionUser["role"]; teamId?: string | null; teamLeaderId?: string | null; name?: string; email?: string }) {
      current = { id: u.id, role: u.role, teamId: u.teamId ?? null, teamLeaderId: u.teamLeaderId ?? null, name: u.name, email: u.email };
    },
    clear() {
      current = null;
    },
  };
}
