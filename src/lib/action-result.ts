/** Uniform result type for server actions so client components can show errors. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = undefined>(error: string): ActionResult<T> {
  return { ok: false, error };
}

/** Error messages safe to show the caller: our own Error()s, auth errors and zod issues. Engine errors are masked. */
export function publicMessage(e: unknown): string {
  if (e && typeof e === "object" && "issues" in e && Array.isArray((e as { issues: unknown[] }).issues)) {
    const issues = (e as { issues: { message: string; path?: (string | number)[] }[] }).issues;
    return issues.map((i) => (i.path?.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");
  }
  if (e instanceof Error) {
    const name = e.constructor?.name ?? "";
    if (name.startsWith("PrismaClient")) {
      console.error("[action] database error", e.message);
      const code = (e as { code?: string }).code;
      if (code === "P2002") return "A record with the same unique value already exists";
      if (code === "P2025") return "Record not found";
      return "Database error";
    }
    return e.message;
  }
  return String(e);
}

export async function wrap<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return fail(publicMessage(e));
  }
}
