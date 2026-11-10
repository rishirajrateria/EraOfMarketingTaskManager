import { vi } from "vitest";
import type { SessionUser } from "@/lib/rbac";

// vitest hoists `vi.mock` factories above every import, so the mock state must be hoisted too.
const state = vi.hoisted(() => ({ current: null as SessionUser | null }));

vi.mock("@/lib/auth", () => ({
  auth: async () => (state.current ? { user: state.current } : null),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));

/**
 * Mocks `@/lib/auth` so `requireUser()` resolves to the given user. Call before importing actions.
 * Usage:  const s = mockSession(); s.set(user);
 */
export function mockSession() {
  return {
    set(u: { id: string; role: SessionUser["role"]; teamId?: string | null; teamLeaderId?: string | null; name?: string; email?: string }) {
      state.current = { id: u.id, role: u.role, teamId: u.teamId ?? null, teamLeaderId: u.teamLeaderId ?? null, name: u.name, email: u.email };
    },
    clear() {
      state.current = null;
    },
  };
}
